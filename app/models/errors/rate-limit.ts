import { Data } from "effect";

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly rule: string;
  readonly retryAfterSeconds: number;
}> {}
