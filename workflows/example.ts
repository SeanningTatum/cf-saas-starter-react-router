import {
  WorkflowEntrypoint,
  WorkflowStep,
  type WorkflowEvent,
} from "cloudflare:workers";

export interface ExampleWorkflowRequestPayload {
  email: string;
  metadata: Record<string, string>;
}
// Note:
// Unfortunately with the current version of the Cloudflare Workers SDK.
// We can only test with `bun run preview` since that is the only time
// wrangler is actually running the workflow.
// By default the dev command still uses next.js dev server.

/**
 * Example Cloudflare Workflow
 * This demonstrates how to use Cloudflare Workflows with full access to env bindings
 *
 * Available env bindings:
 * - this.env.DATABASE (D1)
 * - this.env.BUCKET (R2)
 * - this.env.AI (AI inference)
 * - this.env.EXAMPLE_WORKFLOW (self-reference to workflow)
 */
export class ExampleWorkflow extends WorkflowEntrypoint<
  Env,
  ExampleWorkflowRequestPayload
> {
  async run(
    event: WorkflowEvent<ExampleWorkflowRequestPayload>,
    step: WorkflowStep
  ) {
    console.log("Workflow started", event);

    await step.sleep("sleep for a bit", "1 minute");

    console.log("Workflow finished", event.payload);

    this.env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      prompt: "What is the meaning of life?",
    });

    return {
      success: true,
      message: "Workflow finished successfully",
      email: event.payload.email,
      metadata: event.payload.metadata,
    };
  }
}
