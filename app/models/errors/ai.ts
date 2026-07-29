import { Data } from "effect";

// Raised when the model's response cannot be used: the response body is not
// valid JSON, does not satisfy the prompt module's output schema, or Workers
// AI reports "JSON Mode couldn't be met". Distinct from ExternalServiceError
// (transport/API failure) — this is the model failing the output contract.
export class AiOutputError extends Data.TaggedError("AiOutputError")<{
  readonly promptId: string;
  readonly reason: "invalid_json" | "schema_violation" | "empty_response";
  readonly cause?: unknown;
}> {}

export type AiError = AiOutputError;
