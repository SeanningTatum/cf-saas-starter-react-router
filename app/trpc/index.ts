import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { Cause, Effect, Exit, ParseResult, Schema } from "effect";
import { Session, SessionLive } from "@/services/session";
import type { AppRuntime } from "@/runtime";
import { loggers } from "@/lib/logger";
import { isDev } from "@/lib/log-format";

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

/**
 * Pure, parameterized helpers — same reasoning as `isLevelEnabled` in
 * `lib/log-format.ts`: the module-level `isDev` is always `true` under vitest,
 * so a production branch that read it directly would be untestable.
 */

// tRPC's shape also carries `message` / `code` alongside `data`; the index
// signature keeps those (and any future additions) assignable.
type ErrorShapeLike = { data?: Record<string, unknown>; [key: string]: unknown };

/**
 * Drop `stack` from an error shape outside dev. tRPC only includes it when its
 * own `isDev` is set, so this is defence in depth rather than the primary fix —
 * it keeps stacks out of client payloads even if that config regresses.
 */
export const stripStackOutsideDev = <S extends ErrorShapeLike>(
  shape: S,
  dev: boolean
): S => {
  if (dev || shape.data?.stack === undefined) return shape;
  const { stack: _stack, ...data } = shape.data;
  // TS cannot prove a generic spread still satisfies `S`, so the cast is
  // unavoidable — which means "every other key survives" is guaranteed by the
  // tests, not by the compiler. `preserves every data key except stack` in
  // `__tests__/index.test.ts` is that guarantee; keep it if this is edited.
  return { ...shape, data } as S;
};

/**
 * Artificial latency that makes loading states visible while developing.
 * Returns 0 outside dev — it ran in production for every procedure until
 * tRPC's `isDev` was wired up (see `initTRPC.create` below).
 *
 * Range is [100, 499]ms, not [100, 500]: `Math.random()` is exclusive of 1.
 */
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
  // tRPC defaults `isDev` to `process.env.NODE_ENV !== "production"`. There is
  // no `process.env` on Workers, so it resolved to `true` in production: every
  // error response carried a `stack`, and `timingMiddleware` below slept
  // 100-499ms on every procedure call. Pass the repo's build-time flag
  // (`import.meta.env.DEV`, statically replaced by Vite) instead.
  isDev,
  errorFormatter: ({ shape, error }) =>
    stripStackOutsideDev(
      {
        ...shape,
        data: {
          ...shape.data,
          schemaError: formatSchemaError(error.cause),
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

  // Read the module constant, not `t._config.isDev`: same value (it is what
  // `create` was given), but it keeps both call sites on one source of truth
  // and off tRPC's internal config shape.
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
