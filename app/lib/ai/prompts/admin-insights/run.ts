import { Effect, Schema } from "effect";
import { WorkersAi } from "@/services/ai";
import { AiOutputError } from "@/models/errors/ai";
import type { ExternalServiceError } from "@/models/errors/repository";
import {
  AdminInsightsInput,
  AdminInsightsOutput,
  outputJsonSchema,
  prompt,
} from "./prompt";

/**
 * Executes the admin-insights prompt against the WorkersAi service and
 * enforces the output contract on the way out. Transport/API failures come
 * back as ExternalServiceError from the service; everything wrong with the
 * response body itself is an AiOutputError with a precise `reason`.
 */
export const generateAdminInsights = (
  input: AdminInsightsInput
): Effect.Effect<
  AdminInsightsOutput,
  AiOutputError | ExternalServiceError,
  WorkersAi
> =>
  Effect.gen(function* () {
    const ai = yield* WorkersAi;
    const raw = yield* ai.runJson({
      model: prompt.model,
      messages: [
        { role: "system", content: prompt.system },
        ...prompt.render(input),
      ],
      jsonSchema: outputJsonSchema,
      maxTokens: prompt.maxTokens,
    });

    if (raw === undefined || raw === null || raw === "") {
      return yield* new AiOutputError({
        promptId: prompt.id,
        reason: "empty_response",
      });
    }

    // Workers AI returns `response` as a JSON string for some models and an
    // already-parsed object for others — normalize before decoding.
    const parsed = yield* Effect.try({
      try: () => (typeof raw === "string" ? JSON.parse(raw) : raw),
      catch: (cause) =>
        new AiOutputError({
          promptId: prompt.id,
          reason: "invalid_json",
          cause,
        }),
    });

    return yield* Schema.decodeUnknown(AdminInsightsOutput)(parsed).pipe(
      Effect.mapError(
        (cause) =>
          new AiOutputError({
            promptId: prompt.id,
            reason: "schema_violation",
            cause,
          })
      )
    );
  });
