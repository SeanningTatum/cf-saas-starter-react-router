import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { Cause, Effect, Exit, ParseResult } from "effect";
import { Session, SessionLive } from "@/services/session";
import type { AppRuntime } from "@/runtime";
import { loggers } from "@/lib/logger";
import { isDev } from "@/lib/log-format";
import { setRequestUser } from "@/lib/request-context";
import { hasAdminRole } from "@/auth/protected-user";

export const createTRPCContext = async (opts: {
  headers: Headers;
  runtime: AppRuntime;
}) => {
  const exit = await opts.runtime.runPromiseExit(
    Session.pipe(
      Effect.provide(SessionLive(opts.headers)),
      Effect.tap(({ user }) => setRequestUser(user?.id))
    )
  );

  if (Exit.isFailure(exit)) {
    loggers.trpc.error(
      { cause: Cause.pretty(exit.cause) },
      "Failed to resolve session for tRPC context"
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal Server Error",
    });
  }

  const { session, user } = exit.value;

  return {
    headers: opts.headers,
    runtime: opts.runtime,
    auth: session && user ? { session, user } : null,
  };
};

type ErrorShapeLike = { data?: Record<string, unknown>; [key: string]: unknown };

export const stripStackOutsideDev = <S extends ErrorShapeLike>(
  shape: S,
  dev: boolean
): S => {
  if (dev || shape.data?.stack === undefined) return shape;
  const { stack: _stack, ...data } = shape.data;
  return { ...shape, data } as S;
};

export const devDelayMs = (dev: boolean, random: number = Math.random()) =>
  dev ? Math.floor(random * 400) + 100 : 0;

const formatSchemaError = (cause: unknown) => {
  if (ParseResult.isParseError(cause)) {
    return ParseResult.ArrayFormatter.formatErrorSync(cause).map((issue) => ({
      path: issue.path,
      message: issue.message,
    }));
  }
  return null;
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  isDev,
  errorFormatter: ({ shape, error }) =>
    stripStackOutsideDev(
      {
        ...shape,
        data: {
          ...shape.data,
          schemaError:
            error.code === "BAD_REQUEST" ? formatSchemaError(error.cause) : null,
        },
      },
      isDev
    ),
});

export const createTRPCRouter = t.router;

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();
  const log = loggers.trpc.child({ path });

  log.debug("Procedure starting");

  const waitMs = devDelayMs(isDev);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const durationMs = Date.now() - start;
  log.info({ durationMs }, "Procedure complete");

  return result;
});

export const publicProcedure = t.procedure.use(timingMiddleware);

export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.auth) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
      ctx: {
        ...ctx,
        auth: {
          session: ctx.auth.session,
          user: ctx.auth.user,
        },
      },
    });
  });

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasAdminRole(ctx.auth.user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next();
});

export const createCallerFactory = t.createCallerFactory;

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
