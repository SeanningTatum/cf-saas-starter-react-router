import { Cause, Effect, Exit, ManagedRuntime } from "effect";
import { TRPCError } from "@trpc/server";
import type { AppServices } from "@/runtime";
import type { AppError } from "@/models/errors";
import { loggers } from "@/lib/logger";

// The literal set of tags every AppError union member can carry. Anything
// with a `_tag` outside this set is NOT a known AppError — even though it
// duck-types like one — and must fall through to the generic-500 branch
// below rather than being routed into `appErrorToTRPC`'s switch.
const APP_ERROR_TAGS = new Set<AppError["_tag"]>([
  "NotFoundError",
  "CreationError",
  "UpdateError",
  "DeletionError",
  "QueryError",
  "ValidationError",
  "ConfigurationError",
  "ExternalServiceError",
  "BucketBindingError",
  "BucketUploadError",
  "BucketGetError",
  "BucketNotFoundError",
  "BucketDeleteError",
  "BucketListError",
  "BucketValidationError",
  "WorkflowTriggerError",
]);

// Compile-time exhaustiveness guard for `appErrorToTRPC`'s switch. Reachable
// only if a future AppError variant's tag is added to APP_ERROR_TAGS without
// a matching switch case — never throws; logs and degrades to a generic 500
// so a missed mapping is a defect in observability, not an unhandled crash.
const assertNever = (x: never): TRPCError => {
  const tag =
    typeof x === "object" && x !== null && "_tag" in x
      ? String((x as { _tag: unknown })._tag)
      : "unknown";
  loggers.trpc.error(
    { tag },
    "appErrorToTRPC: unhandled tagged error variant — add a case + a tagToTRPC test"
  );
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal Server Error",
  });
};

const isAppError = (e: unknown): e is AppError =>
  typeof e === "object" &&
  e !== null &&
  "_tag" in e &&
  typeof (e as { _tag: unknown })._tag === "string" &&
  APP_ERROR_TAGS.has((e as { _tag: AppError["_tag"] })._tag);

const appErrorToTRPC = (e: AppError): TRPCError => {
  switch (e._tag) {
    case "NotFoundError":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `${e.entity} not found: ${e.identifier}`,
      });
    case "ValidationError":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: e.message,
      });
    case "CreationError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to create ${e.entity}`,
        cause: e.cause,
      });
    case "UpdateError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to update ${e.entity}`,
        cause: e.cause,
      });
    case "DeletionError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to delete ${e.entity}`,
        cause: e.cause,
      });
    case "QueryError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to query ${e.entity}`,
        cause: e.cause,
      });
    case "ConfigurationError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Configuration error for ${e.service}${
          e.field ? ` (${e.field})` : ""
        }`,
      });
    case "ExternalServiceError":
      return new TRPCError({
        code: "BAD_GATEWAY",
        message: `External service error: ${e.service}`,
        cause: e.cause,
      });
    case "BucketBindingError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: e.message ?? "BUCKET binding not found",
      });
    case "BucketUploadError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to upload to R2",
        cause: e.cause,
      });
    case "BucketGetError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get from R2",
        cause: e.cause,
      });
    case "BucketNotFoundError":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `File not found: ${e.key}`,
      });
    case "BucketDeleteError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to delete from R2",
        cause: e.cause,
      });
    case "BucketListError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to list R2 objects",
        cause: e.cause,
      });
    case "BucketValidationError":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: e.message,
      });
    case "WorkflowTriggerError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to trigger workflow: ${e.name}`,
        cause: e.cause,
      });
    default:
      return assertNever(e);
  }
};

// Generic fallback for anything that isn't a pre-existing TRPCError or a
// known AppError (a raw thrown Error, a rejected promise's reason, etc).
// The raw message/stack is logged server-side only — never sent to the
// client, which only ever sees a generic "Internal Server Error".
const toTRPC = (err: unknown): TRPCError => {
  if (err instanceof TRPCError) return err;
  if (isAppError(err)) return appErrorToTRPC(err);
  loggers.trpc.error(
    {
      err:
        err instanceof Error
          ? { name: err.name, message: err.message, stack: err.stack }
          : err,
    },
    "Unhandled error in tRPC procedure"
  );
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal Server Error",
  });
};

export const tagToTRPC = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, TRPCError, R> =>
  Effect.catchAll(effect, (err) => Effect.fail(toTRPC(err)));

// The runtime's own layer construction can fail — a missing D1/R2/Workflow
// binding or a broken Better Auth config surfaces as ConfigurationError |
// ExternalServiceError | BucketBindingError when the request-scoped
// ManagedRuntime resolves its services. That failure is NOT part of
// `effect`'s own error channel (E) — it's injected by the runtime when it
// builds AppServices — so it can only be observed via `runPromiseExit`,
// never by wrapping `effect` itself in `catchAll` beforehand. We run the
// already-mapped (tagToTRPC) effect via `runPromiseExit` and translate BOTH
// the effect's own (now-TRPCError) failures and any layer-construction
// failure through the same `toTRPC` mapping, so a missing binding produces a
// clean, logged 500 instead of a raw rejection.
export const runProcedure = <A, E, R extends AppServices = AppServices>(
  runtime: ManagedRuntime.ManagedRuntime<AppServices, AppError>,
  effect: Effect.Effect<A, E, R>
): Promise<A> =>
  runtime
    .runPromiseExit(tagToTRPC(effect).pipe(Effect.annotateLogs({ layer: "trpc" })))
    .then((exit) =>
      Exit.match(exit, {
        onSuccess: (value) => value,
        onFailure: (cause) => {
          const failure = Cause.failureOption(cause);
          if (failure._tag === "Some") {
            throw toTRPC(failure.value);
          }
          // Unrecoverable defect (interruption, die, etc) — log full cause,
          // never leak it to the client.
          loggers.trpc.error(
            { cause: Cause.pretty(cause) },
            "Unhandled defect in tRPC procedure"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal Server Error",
          });
        },
      })
    );
