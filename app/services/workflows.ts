import { Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import { WorkflowTriggerError } from "@/models/errors/workflow";
import { ConfigurationError } from "@/models/errors/repository";
import type { CreateWorkflowInput } from "@/lib/schemas/user";

type WorkflowInstance = Awaited<ReturnType<Workflow["create"]>>;

export interface WorkflowsShape {
  readonly exampleWorkflow: Workflow;
  readonly triggerExample: (
    params: CreateWorkflowInput
  ) => Effect.Effect<WorkflowInstance, WorkflowTriggerError>;
}

export class Workflows extends Context.Tag("app/Workflows")<
  Workflows,
  WorkflowsShape
>() {}

export const WorkflowsLive = Layer.effect(
  Workflows,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    // EXAMPLE_WORKFLOW is declared non-optional in the generated Env type,
    // but (like BUCKET) the binding can be absent from an actual deployment
    // (workflow not configured in wrangler). Fail fast with a typed
    // ConfigurationError — mirrors DatabaseLive/BucketLive — instead of
    // letting a missing binding surface as a confusing TypeError deep inside
    // WorkflowTriggerError's `cause`.
    const exampleWorkflow = (env as Env & { EXAMPLE_WORKFLOW?: Workflow })
      .EXAMPLE_WORKFLOW;
    if (!exampleWorkflow) {
      return yield* Effect.fail(
        new ConfigurationError({
          service: "Workflows",
          field: "EXAMPLE_WORKFLOW",
        })
      );
    }
    return {
      exampleWorkflow,
      triggerExample: (params: CreateWorkflowInput) =>
        Effect.tryPromise({
          try: () => exampleWorkflow.create({ params }),
          catch: (cause) =>
            new WorkflowTriggerError({ name: "EXAMPLE_WORKFLOW", cause }),
        }),
    };
  })
);
