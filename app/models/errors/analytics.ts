import { Data } from "effect";

/**
 * An analytics provider rejected or failed to receive a batch. It never
 * reaches a client: `Analytics` logs it and drops the batch.
 */
export class AnalyticsDeliveryError extends Data.TaggedError(
  "AnalyticsDeliveryError"
)<{
  readonly provider: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}
