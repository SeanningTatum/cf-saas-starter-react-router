import { Effect, Schema } from "effect";
import { BucketValidationError } from "@/models/errors/bucket";
import { ExternalServiceError } from "@/models/errors/repository";
import { API_ROUTES } from "@/lib/constants/routes";

export const UPLOAD_ENDPOINT = API_ROUTES.uploadFile;

const UploadRouteReplyOnEveryStatus = Schema.Union(
  Schema.Struct({ success: Schema.Literal(true), key: Schema.String }),
  Schema.Struct({ success: Schema.Literal(false), error: Schema.String })
);

export type UploadClientError = BucketValidationError | ExternalServiceError;

const unreachable = (cause: unknown) =>
  new ExternalServiceError({ service: "upload-file", cause });

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
    const reply = yield* Schema.decodeUnknown(UploadRouteReplyOnEveryStatus)(json).pipe(
      Effect.mapError(unreachable)
    );

    if (!reply.success) {
      return yield* Effect.fail(
        new BucketValidationError({ message: reply.error, field: "file" })
      );
    }
    return { key: reply.key };
  });
