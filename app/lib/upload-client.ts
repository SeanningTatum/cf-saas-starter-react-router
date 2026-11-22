import { Effect, Schema } from "effect";
import { BucketValidationError } from "@/models/errors/bucket";
import { ExternalServiceError } from "@/models/errors/repository";

export const UPLOAD_ENDPOINT = "/api/upload-file";

// What app/routes/api/upload-file.ts returns on every branch, 4xx/5xx included.
const UploadReply = Schema.Union(
  Schema.Struct({ success: Schema.Literal(true), key: Schema.String }),
  Schema.Struct({ success: Schema.Literal(false), error: Schema.String })
);

export type UploadClientError = BucketValidationError | ExternalServiceError;

const unreachable = (cause: unknown) =>
  new ExternalServiceError({ service: "upload-file", cause });

/**
 * POSTs one file to the upload route from the browser.
 *
 * The route's own refusal (wrong type, too big, signed out) fails with a
 * BucketValidationError carrying the route's message, which is safe to show.
 * Anything that stops a readable reply (offline, aborted, a body that is not
 * the route's JSON) fails with an ExternalServiceError.
 */
export const uploadFile = (
  file: File
): Effect.Effect<{ readonly key: string }, UploadClientError> =>
  Effect.gen(function* () {
    const body = new FormData();
    body.append("file", file);

    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(UPLOAD_ENDPOINT, { method: "POST", body, signal }),
      catch: unreachable,
    });
    const json = yield* Effect.tryPromise({
      try: (): Promise<unknown> => response.json(),
      catch: unreachable,
    });
    const reply = yield* Schema.decodeUnknown(UploadReply)(json).pipe(
      Effect.mapError(unreachable)
    );

    if (!reply.success) {
      return yield* Effect.fail(
        new BucketValidationError({ message: reply.error, field: "file" })
      );
    }
    return { key: reply.key };
  });
