import type { Effect } from "effect";
import type { AnalyticsDeliveryError } from "@/models/errors/analytics";

export interface CapturedEvent {
  readonly event: string;
  readonly distinctId: string;
  readonly properties: Record<string, unknown>;
  readonly timestamp: string;
}

/** A provider. `send` takes one batch; `Analytics` logs a failure and drops it. */
export interface AnalyticsAdapter {
  readonly name: string;
  readonly send: (
    batch: ReadonlyArray<CapturedEvent>
  ) => Effect.Effect<void, AnalyticsDeliveryError>;
}
