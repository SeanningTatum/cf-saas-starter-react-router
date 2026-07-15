import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer } from "effect";
import { Workflows, WorkflowsLive } from "../workflows";
import { CloudflareEnv } from "../cloudflare";
import { WorkflowTriggerError } from "@/models/errors/workflow";
import { ConfigurationError } from "@/models/errors/repository";

const envLayer = (workflow: Partial<Workflow>) =>
  Layer.succeed(CloudflareEnv, { EXAMPLE_WORKFLOW: workflow as Workflow } as Env);

describe("WorkflowsLive.triggerExample", () => {
  it.effect("returns the created instance on success", () =>
    Effect.gen(function* () {
      const wf = yield* Workflows;
      const result = yield* wf.triggerExample({ email: "a@b.c", metadata: {} });
      expect((result as { id: string }).id).toBe("inst-1");
    }).pipe(
      Effect.provide(
        WorkflowsLive.pipe(
          Layer.provide(
            envLayer({
              create: async () => ({ id: "inst-1" }) as unknown as Awaited<
                ReturnType<Workflow["create"]>
              >,
            })
          )
        )
      )
    )
  );

  it.effect("fails with WorkflowTriggerError when create rejects", () =>
    Effect.gen(function* () {
      const wf = yield* Workflows;
      const exit = yield* Effect.exit(
        wf.triggerExample({ email: "a@b.c", metadata: {} })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(WorkflowTriggerError);
          expect((failure.value as WorkflowTriggerError).name).toBe(
            "EXAMPLE_WORKFLOW"
          );
        }
      }
    }).pipe(
      Effect.provide(
        WorkflowsLive.pipe(
          Layer.provide(
            envLayer({
              create: async () => {
                throw new Error("boom");
              },
            })
          )
        )
      )
    )
  );

  it.effect("fails with ConfigurationError when EXAMPLE_WORKFLOW binding is missing", () =>
    Effect.gen(function* () {
      const program = Workflows.pipe(
        Effect.provide(
          WorkflowsLive.pipe(
            Layer.provide(Layer.succeed(CloudflareEnv, {} as Env))
          )
        )
      );
      const exit = yield* Effect.exit(program);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ConfigurationError);
          expect((failure.value as ConfigurationError).service).toBe(
            "Workflows"
          );
          expect((failure.value as ConfigurationError).field).toBe(
            "EXAMPLE_WORKFLOW"
          );
        }
      }
    })
  );
});
