import { Effect, Exit, Schema } from "effect";
import { data } from "react-router";
import { BucketRepository } from "@/repositories/bucket";
import { ValidationError } from "@/models/errors/repository";
import { BucketValidationError } from "@/models/errors/bucket";
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_CONTENT_TYPES,
} from "@/lib/constants/upload";
import type { Route } from "./+types/upload-file";

const UploadedFileMeta = Schema.Struct({
  size: Schema.Number.pipe(Schema.lessThanOrEqualTo(MAX_UPLOAD_SIZE_BYTES)),
  type: Schema.Literal(...ALLOWED_UPLOAD_CONTENT_TYPES),
});

export async function action({ request, context }: Route.ActionArgs) {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) {
    return data({ success: false as const, error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  const program = Effect.gen(function* () {
    if (!(file instanceof File)) {
      return yield* Effect.fail(
        new ValidationError({
          entity: "file",
          field: "file",
          message: "No file provided",
        })
      );
    }

    yield* Schema.decodeUnknown(UploadedFileMeta)(
      { size: file.size, type: file.type },
      { errors: "all" }
    ).pipe(
      Effect.mapError(
        () =>
          new BucketValidationError({
            message: `File must be one of [${ALLOWED_UPLOAD_CONTENT_TYPES.join(", ")}] and at most ${
              MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
            }MB`,
            field: "file",
          })
      )
    );

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
    })
  );

  const exit = await context.runtime.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: (response) => response,
    onFailure: () =>
      data({ success: false as const, error: "Internal Server Error" }, { status: 500 }),
  });
}
