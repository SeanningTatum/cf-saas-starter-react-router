import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { WorkersAi, WorkersAiLive } from "../ai";
import { CloudflareEnv } from "../cloudflare";
import {
  ConfigurationError,
  ExternalServiceError,
} from "@/models/errors/repository";

const runInput = {
  model: "@cf/moonshotai/kimi-k2.5",
  messages: [{ role: "user" as const, content: "hi" }],
  jsonSchema: { type: "object" },
};

const envLayer = (ai: Partial<Ai> | undefined) =>
  Layer.succeed(CloudflareEnv, { AI: ai as Ai } as Env);

describe("WorkersAiLive.runJson", () => {
  it.effect("calls ai.run with json_schema response_format", () =>
    Effect.gen(function* () {
      let capturedModel: unknown;
      let capturedInputs: unknown;
      const ai: Partial<Ai> = {
        run: (async (model: string, inputs: Record<string, unknown>) => {
          capturedModel = model;
          capturedInputs = inputs;
          return { response: "{\"a\":1}" };
        }) as Ai["run"],
      };
      const service = yield* WorkersAi.pipe(
        Effect.provide(WorkersAiLive.pipe(Layer.provide(envLayer(ai))))
      );
      const result = yield* service.runJson(runInput);
      expect(result).toBe("{\"a\":1}");
      expect(capturedModel).toBe(runInput.model);
      const inputs = capturedInputs as Record<string, unknown>;
      expect(inputs.response_format).toEqual({
        type: "json_schema",
        json_schema: runInput.jsonSchema,
      });
      expect(inputs.messages).toEqual(runInput.messages);
    })
  );

  // kimi-k2.5 returns an OpenAI chat.completion object, not `{ response }` —
  // verified live against the binding 2026-07-29.
  it.effect("normalizes the OpenAI chat.completion shape (kimi)", () =>
    Effect.gen(function* () {
      const ai: Partial<Ai> = {
        run: (async () => ({
          id: "x",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "{\"headline\":\"hi\"}",
                reasoning_content: "thinking…",
              },
            },
          ],
        })) as unknown as Ai["run"],
      };
      const service = yield* WorkersAi.pipe(
        Effect.provide(WorkersAiLive.pipe(Layer.provide(envLayer(ai))))
      );
      const result = yield* service.runJson(runInput);
      expect(result).toBe("{\"headline\":\"hi\"}");
    })
  );

  it.effect("fails with ExternalServiceError when ai.run rejects", () =>
    Effect.gen(function* () {
      const ai: Partial<Ai> = {
        run: (async () => {
          throw new Error("JSON Mode couldn't be met");
        }) as Ai["run"],
      };
      const exit = yield* Effect.exit(
        WorkersAi.pipe(
          Effect.flatMap((s) => s.runJson(runInput)),
          Effect.provide(WorkersAiLive.pipe(Layer.provide(envLayer(ai))))
        )
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ExternalServiceError);
          expect((failure.value as ExternalServiceError).service).toBe(
            "WorkersAi"
          );
        }
      }
    })
  );

  it.effect("fails with ConfigurationError when the AI binding is missing", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        WorkersAi.pipe(
          Effect.provide(
            WorkersAiLive.pipe(Layer.provide(envLayer(undefined)))
          )
        )
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ConfigurationError);
          expect((failure.value as ConfigurationError).service).toBe(
            "WorkersAi"
          );
          expect((failure.value as ConfigurationError).field).toBe("AI");
        }
      }
    })
  );
});
