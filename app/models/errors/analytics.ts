import { Data } from "effect";

export class AnalyticsDeliveryError extends Data.TaggedError(
  "AnalyticsDeliveryError"
)<{
  readonly provider: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}
