import { Effect } from "effect";
import { BucketRepository } from "@/repositories/bucket";
import { ValidationError } from "@/models/errors/repository";
import { runProcedure } from "@/lib/effect-trpc";
import type { Route } from "./+types/upload-file";

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const file = formData.get("file");

  const program = Effect.gen(function* () {
    if (!file || !(file instanceof File)) {
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
    Effect.tapErrorCause((cause) => Effect.logError("Upload failed", cause))
  );

  try {
    return await runProcedure(context.runtime, program);
  } catch (err) {
    const status =
      err && typeof err === "object" && "code" in err && err.code === "BAD_REQUEST"
        ? 400
        : 500;
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Upload failed";
    throw new Response(message, { status });
  }
}
