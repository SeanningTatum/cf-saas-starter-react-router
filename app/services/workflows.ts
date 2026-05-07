import { Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import { WorkflowTriggerError } from "@/models/errors/workflow";
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
  Effect.map(CloudflareEnv, (env) => {
    const exampleWorkflow = env.EXAMPLE_WORKFLOW;
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
