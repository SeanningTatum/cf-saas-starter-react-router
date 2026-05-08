import { Effect, Exit } from "effect";
import { BucketRepository } from "@/repositories/bucket";
import { ValidationError } from "@/models/errors/repository";
import type { Route } from "./+types/upload-file";

export async function action({ request, context }: Route.ActionArgs) {
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
    const repo = yield* BucketRepository;
    const key = yield* repo.upload(file);
    return { success: true as const, key };
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.logError("Upload failed", cause)),
    Effect.catchTag("ValidationError", (e) =>
      Effect.succeed(new Response(e.message, { status: 400 }))
    )
  );

  const exit = await context.runtime.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: (result) => result,
    onFailure: () => new Response("Internal Server Error", { status: 500 }),
  });
}
