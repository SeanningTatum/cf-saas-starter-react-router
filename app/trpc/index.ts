import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { Effect, ParseResult, Schema } from "effect";
import { AuthApi } from "@/services/auth";
import type { AppRuntime } from "@/runtime";
import { loggers } from "@/lib/logger";

export const createTRPCContext = async (opts: {
  headers: Headers;
  runtime: AppRuntime;
}) => {
  const session = await opts.runtime.runPromise(
    Effect.gen(function* () {
      const { api } = yield* AuthApi;
      return yield* Effect.promise(() =>
        api.getSession({ headers: opts.headers })
      );
    })
  );

  return {
    headers: opts.headers,
    runtime: opts.runtime,
    auth: session
      ? {
          session: session.session,
          user: session.user,
        }
      : null,
  };
};

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
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      schemaError: formatSchemaError(error.cause),
    },
  }),
});

export const createTRPCRouter = t.router;

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();
  const log = loggers.trpc.child({ path });

  log.debug("Procedure starting");

  if (t._config.isDev) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
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
          session: ctx.auth.session!,
          user: ctx.auth.user!,
        },
      },
    });
  });

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.auth.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next();
});

export const createCallerFactory = t.createCallerFactory;

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

export { Schema };
