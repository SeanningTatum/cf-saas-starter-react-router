import { Cause, Effect, Exit, type ManagedRuntime } from "effect";
import { TRPCError } from "@trpc/server";
import type { AppServices } from "@/runtime";
import type { AppError } from "@/models/errors/app-error";
import { loggers } from "@/lib/logger";
import { RATE_LIMITED_MESSAGE } from "@/lib/constants/rate-limit";
import { TRPC_SERVER_FAILURE_CODES } from "@/lib/constants/error-reporting";
import { APP_ERROR_TAGS } from "@/lib/constants/errors";

const assertNever = (x: never): TRPCError => {
  const tag =
    typeof x === "object" && x !== null && "_tag" in x
      ? String((x as { _tag: unknown })._tag)
      : "unknown";
  loggers.trpc.error(
    { tag },
    "appErrorToTRPC: unhandled tagged error variant — add a case + a tagToTRPC test",
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
        message: `Configuration error for ${e.service}${e.field ? ` (${e.field})` : ""}`,
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
    case "UploadQuotaError":
      return new TRPCError({
        code: "PAYLOAD_TOO_LARGE",
        message: e.message,
      });
    case "AnalyticsDeliveryError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal Server Error",
        cause: e.cause,
      });
    case "RateLimitError":
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: RATE_LIMITED_MESSAGE,
      });
    case "FixtureValidationError":
    case "SeedError":
    case "FixtureLoginError":
    case "RealAnalyticsProviderError":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal Server Error",
        cause: e,
      });
    case "DevServerRunningError":
      return new TRPCError({
        code: "CONFLICT",
        message: "Stop the dev server first",
      });
    case "SandboxDisabledError":
    case "SandboxUnknownModuleError":
    case "SandboxUnknownScenarioError":
    case "SandboxCaseNotDeclaredError":
      return new TRPCError({ code: "NOT_FOUND", message: "Not Found" });
    default:
      return assertNever(e);
  }
};

const withOrigin = (mapped: TRPCError, origin: AppError): TRPCError =>
  TRPC_SERVER_FAILURE_CODES.includes(mapped.code)
    ? new TRPCError({ code: mapped.code, message: mapped.message, cause: origin })
    : mapped;

const toTRPC = (err: unknown): TRPCError => {
  if (err instanceof TRPCError) return err;
  if (isAppError(err)) return withOrigin(appErrorToTRPC(err), err);
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal Server Error",
    cause: err,
  });
};

export const tagToTRPC = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, TRPCError, R> => Effect.catchAll(effect, (err) => Effect.fail(toTRPC(err)));

export const runProcedure = <A, E, R extends AppServices = AppServices>(
  runtime: ManagedRuntime.ManagedRuntime<AppServices, AppError>,
  effect: Effect.Effect<A, E, R>,
  options?: { readonly span?: string },
): Promise<A> =>
  runtime
    .runPromiseExit(
      tagToTRPC(effect).pipe(
        Effect.annotateLogs({ layer: "trpc" }),
        options?.span ? Effect.withSpan(options.span, { kind: "server" }) : (self) => self,
      ),
    )
    .then((exit) =>
      Exit.match(exit, {
        onSuccess: (value) => value,
        onFailure: (cause) => {
          const failure = Cause.failureOption(cause);
          if (failure._tag === "Some") {
            throw toTRPC(failure.value);
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal Server Error",
            cause: Cause.squash(cause),
          });
        },
      }),
    );
