import { Effect, Exit, Schema } from "effect";
import { data } from "react-router";
import { BucketRepository } from "@/repositories/bucket";
import { ExternalServiceError, ValidationError } from "@/models/errors/repository";
import { BucketValidationError } from "@/models/errors/bucket";
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_CONTENT_TYPES,
  MAGIC_BYTES_SNIFF_LENGTH,
  matchesMagicBytes,
} from "@/lib/constants/upload";
import type { Route } from "./+types/upload-file";

const UploadedFileMeta = Schema.Struct({
  size: Schema.Number.pipe(Schema.lessThanOrEqualTo(MAX_UPLOAD_SIZE_BYTES)),
  type: Schema.Literal(...ALLOWED_UPLOAD_CONTENT_TYPES),
});

const typeAndSizeMessage = `File must be one of [${ALLOWED_UPLOAD_CONTENT_TYPES.join(", ")}] and at most ${
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
}MB`;

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const file = formData.get("file");

  const program = Effect.gen(function* () {
    const session = yield* Effect.tryPromise({
      try: () => context.auth.api.getSession({ headers: request.headers }),
      catch: (cause) => new ExternalServiceError({ service: "BetterAuth", cause }),
    });
    if (!session) {
      return data({ success: false as const, error: "Unauthorized" }, { status: 401 });
    }

    if (!(file instanceof File)) {
      return yield* Effect.fail(
        new ValidationError({
          entity: "file",
          field: "file",
          message: "No file provided",
        })
      );
    }

    const meta = yield* Schema.decodeUnknown(UploadedFileMeta)(
      { size: file.size, type: file.type },
      { errors: "all" }
    ).pipe(
      Effect.mapError(
        () =>
          new BucketValidationError({
            message: typeAndSizeMessage,
            field: "file",
          })
      )
    );

    // The declared multipart type is client-controlled — verify the actual
    // leading bytes match the declared type's signature.
    const head = yield* Effect.tryPromise({
      try: () => file.slice(0, MAGIC_BYTES_SNIFF_LENGTH).arrayBuffer(),
      catch: (cause) =>
        new ExternalServiceError({ service: "FileRead", cause }),
    });
    if (!matchesMagicBytes(meta.type, new Uint8Array(head))) {
      return yield* Effect.fail(
        new BucketValidationError({
          message: "File content does not match its declared type",
          field: "file",
        })
      );
    }

    const repo = yield* BucketRepository;
    const key = yield* repo.upload(file);
    return data({ success: true as const, key });
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.logError("Upload failed", cause)),
    Effect.catchTags({
      ValidationError: (e) =>
        Effect.succeed(
          data({ success: false as const, error: e.message }, { status: 400 })
        ),
      BucketValidationError: (e) =>
        Effect.succeed(
          data({ success: false as const, error: e.message }, { status: 400 })
        ),
      // Transient upstream failure (Better Auth session lookup, file read) —
      // 503 so clients can distinguish "retry later" from a real 500.
      ExternalServiceError: () =>
        Effect.succeed(
          data(
            { success: false as const, error: "Service temporarily unavailable" },
            { status: 503 }
          )
        ),
    })
  );

  const exit = await context.runtime.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: (response) => response,
    onFailure: () =>
      data({ success: false as const, error: "Internal Server Error" }, { status: 500 }),
  });
}
