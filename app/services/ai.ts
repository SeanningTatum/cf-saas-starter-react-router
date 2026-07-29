import { Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import {
  ConfigurationError,
  ExternalServiceError,
} from "@/models/errors/repository";

export interface WorkersAiRunInput {
  readonly model: string;
  readonly messages: readonly { role: "system" | "user"; content: string }[];
  readonly jsonSchema: Record<string, unknown>;
  readonly maxTokens?: number;
  /** Workers AI reasoning effort ("low" | "medium" | "high") for reasoning models like kimi-k2.5. */
  readonly reasoningEffort?: string;
}

export interface WorkersAiShape {
  /**
   * One-shot chat completion with `response_format: json_schema` (Workers AI
   * JSON Mode — no streaming). Returns the raw `response` field: a JSON
   * string or an already-parsed object, depending on the model. Callers own
   * parsing + schema validation (see the prompt module's run.ts).
   */
  readonly runJson: (
    input: WorkersAiRunInput
  ) => Effect.Effect<unknown, ExternalServiceError>;
}

export class WorkersAi extends Context.Tag("app/WorkersAi")<
  WorkersAi,
  WorkersAiShape
>() {}

export const WorkersAiLive = Layer.effect(
  WorkersAi,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    // Same missing-binding guard as WorkflowsLive: the generated Env type
    // declares AI non-optional, but a deployment without the `ai` block in
    // wrangler.jsonc would otherwise surface a TypeError deep inside
    // ExternalServiceError's `cause`.
    const ai = (env as Env & { AI?: Ai }).AI;
    if (!ai) {
      return yield* Effect.fail(
        new ConfigurationError({ service: "WorkersAi", field: "AI" })
      );
    }
    return {
      runJson: (input: WorkersAiRunInput) =>
        Effect.tryPromise({
          try: async () => {
            const result = (await ai.run(
              input.model as Parameters<Ai["run"]>[0],
              {
                messages: [...input.messages],
                max_tokens: input.maxTokens,
                reasoning_effort: input.reasoningEffort,
                response_format: {
                  type: "json_schema",
                  json_schema: input.jsonSchema,
                },
              } as Parameters<Ai["run"]>[1]
            )) as
              | string
              | {
                  response?: unknown;
                  choices?: { message?: { content?: unknown } }[];
                };
            // The binding's return shape is model-dependent: older text
            // models return `{ response }`, while chat models (verified live
            // against kimi-k2.5, 2026-07-29) return an OpenAI chat.completion
            // object whose payload is `choices[0].message.content`.
            if (typeof result === "string") return result;
            if (result && typeof result === "object") {
              if (result.response !== undefined) return result.response;
              const content = result.choices?.[0]?.message?.content;
              if (content !== undefined) return content;
            }
            return undefined;
          },
          catch: (cause) =>
            new ExternalServiceError({ service: "WorkersAi", cause }),
        }),
    };
  })
);
