import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { Cause, Effect, Exit, ParseResult, Schema } from "effect";
import { Session, SessionLive } from "@/services/session";
import type { AppRuntime } from "@/runtime";
import { loggers } from "@/lib/logger";

// Decision (fix 5): wire the already-tested `Session`/`SessionLive` service
// in as the single source of truth for session resolution, rather than
// deleting it. `SessionLive(headers)` is per-request (needs the request's
// Headers) so it's provided locally here — exactly the pattern documented
// in `.brain/rules/services.md` "Session" section — instead of being added
// to the global `AppServices` union in runtime.ts, which is built once per
// request before headers are threaded through and has no per-request
// parameter today. This also replaces the previous `Effect.promise(() =>
// api.getSession(...))`, which turned a throwing Better Auth call into an
// unrecoverable defect; `SessionLive` already wraps it in `Effect.tryPromise`
// mapped to `ExternalServiceError`.
export const createTRPCContext = async (opts: {
  headers: Headers;
  runtime: AppRuntime;
}) => {
  const exit = await opts.runtime.runPromiseExit(
    Session.pipe(Effect.provide(SessionLive(opts.headers)))
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
          session: ctx.auth.session,
          user: ctx.auth.user,
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
