import { Effect, ManagedRuntime } from "effect";
import { TRPCError } from "@trpc/server";
import type { AppServices } from "@/runtime";
import type { AppError } from "@/models/errors";

const assertNever = (x: never): never => {
  throw new Error(`unhandled tagged error: ${JSON.stringify(x)}`);
};

const isAppError = (e: unknown): e is AppError =>
  typeof e === "object" &&
  e !== null &&
  "_tag" in e &&
  typeof (e as { _tag: unknown })._tag === "string";

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

const toTRPC = (err: unknown): TRPCError => {
  if (err instanceof TRPCError) return err;
  if (isAppError(err)) return appErrorToTRPC(err);
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : "Unknown error",
    cause: err,
  });
};

export const tagToTRPC = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, TRPCError, R> =>
  Effect.catchAll(effect, (err) => Effect.fail(toTRPC(err)));

export const runProcedure = <A, E, R extends AppServices = AppServices>(
  runtime: ManagedRuntime.ManagedRuntime<AppServices, unknown>,
  effect: Effect.Effect<A, E, R>
): Promise<A> =>
  (
    runtime as ManagedRuntime.ManagedRuntime<AppServices, never>
  ).runPromise(
    tagToTRPC(effect).pipe(
      Effect.annotateLogs({ layer: "trpc" })
    ) as Effect.Effect<A, TRPCError, AppServices>
  );
