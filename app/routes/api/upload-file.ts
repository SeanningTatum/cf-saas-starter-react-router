import { Clock, Effect, Exit, Schema } from "effect";
import { data } from "react-router";
import { BucketRepository } from "@/repositories/bucket";
import { activeSession } from "@/auth/ban";
import { ExternalServiceError, ValidationError } from "@/models/errors/repository";
import { BucketValidationError } from "@/models/errors/bucket";
import { RateLimiter } from "@/services/rate-limit";
import {
  HTTP_TOO_MANY_REQUESTS,
  RETRY_AFTER_HEADER,
  UPLOAD_RATE_LIMITED_MESSAGE,
} from "@/lib/constants/rate-limit";
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_CONTENT_TYPES,
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_UNAUTHORIZED,
  MAGIC_BYTES_SNIFF_LENGTH,
  UPLOAD_CONTENT_MISMATCH_MESSAGE,
  UPLOAD_FAILED_LOG,
  UPLOAD_FAILED_MESSAGE,
  UPLOAD_NO_FILE_MESSAGE,
  UPLOAD_NOT_A_FORM_MESSAGE,
  UPLOAD_TOO_LARGE_MESSAGE,
  UPLOAD_TYPE_AND_SIZE_MESSAGE,
  UPLOAD_UNAUTHORIZED_MESSAGE,
  UPLOAD_UNAVAILABLE_MESSAGE,
  declaresOversizedUpload,
  matchesMagicBytes,
} from "@/lib/constants/upload";
import { UPLOAD_READ_HEAD_SPAN, UPLOAD_STORE_FILE_SPAN } from "@/lib/constants/spans";
import { getSession } from "@/services/session";
import { ErrorReporter } from "@/services/error-reporter";
import type { Route } from "./+types/upload-file";

const UploadedFileMeta = Schema.Struct({
  size: Schema.Number.pipe(Schema.lessThanOrEqualTo(MAX_UPLOAD_SIZE_BYTES)),
  type: Schema.Literal(...ALLOWED_UPLOAD_CONTENT_TYPES),
});

const refusal = (error: string, status: number, headers?: HeadersInit) =>
  data({ success: false as const, error }, { status, headers });

const fileField = (message: string) =>
  new ValidationError({ entity: "file", field: "file", message });

export async function action({ request, context }: Route.ActionArgs) {
  const program = Effect.gen(function* () {
    const session = yield* getSession(context.auth.api, request.headers);
    const signedIn = activeSession(session, new Date(yield* Clock.currentTimeMillis));
    if (!signedIn) {
      return refusal(UPLOAD_UNAUTHORIZED_MESSAGE, HTTP_UNAUTHORIZED);
    }

    const limiter = yield* RateLimiter;
    yield* limiter.check("upload", signedIn.user.id);

    if (declaresOversizedUpload(request.headers)) {
      return refusal(UPLOAD_TOO_LARGE_MESSAGE, HTTP_PAYLOAD_TOO_LARGE);
    }

    const formData = yield* Effect.tryPromise({
      try: () => request.formData(),
      catch: () => fileField(UPLOAD_NOT_A_FORM_MESSAGE),
    });
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return yield* Effect.fail(fileField(UPLOAD_NO_FILE_MESSAGE));
    }

    const meta = yield* Schema.decodeUnknown(UploadedFileMeta)(
      { size: file.size, type: file.type },
      { errors: "all" },
    ).pipe(
      Effect.mapError(
        () => new BucketValidationError({ message: UPLOAD_TYPE_AND_SIZE_MESSAGE, field: "file" }),
      ),
    );

    const head = yield* Effect.tryPromise({
      try: () => file.slice(0, MAGIC_BYTES_SNIFF_LENGTH).arrayBuffer(),
      catch: (cause) => new ExternalServiceError({ service: "FileRead", cause }),
    }).pipe(Effect.withSpan(UPLOAD_READ_HEAD_SPAN));
    if (!matchesMagicBytes(meta.type, new Uint8Array(head))) {
      return yield* Effect.fail(
        new BucketValidationError({ message: UPLOAD_CONTENT_MISMATCH_MESSAGE, field: "file" }),
      );
    }

    const repo = yield* BucketRepository;
    const key = yield* repo.upload(file);
    return data({ success: true as const, key });
  }).pipe(
    Effect.catchTag("RateLimitError", (e) =>
      Effect.succeed(
        refusal(UPLOAD_RATE_LIMITED_MESSAGE, HTTP_TOO_MANY_REQUESTS, {
          [RETRY_AFTER_HEADER]: String(e.retryAfterSeconds),
        }),
      ),
    ),
    Effect.tapErrorCause((cause) => Effect.logError(UPLOAD_FAILED_LOG, cause)),
    Effect.withSpan(UPLOAD_STORE_FILE_SPAN),
    Effect.catchTags({
      ValidationError: (e) => Effect.succeed(refusal(e.message, HTTP_BAD_REQUEST)),
      BucketValidationError: (e) => Effect.succeed(refusal(e.message, HTTP_BAD_REQUEST)),
      ExternalServiceError: (error) =>
        Effect.as(
          Effect.flatMap(ErrorReporter, (reporter) =>
            reporter.capture({ error, source: "upload" }),
          ),
          refusal(UPLOAD_UNAVAILABLE_MESSAGE, HTTP_SERVICE_UNAVAILABLE),
        ),
    }),
  );

  const exit = await context.runtime.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: (response) => response,
    onFailure: (cause) => {
      context.reportError({ error: cause, source: "upload" });
      return refusal(UPLOAD_FAILED_MESSAGE, HTTP_INTERNAL_SERVER_ERROR);
    },
  });
}
