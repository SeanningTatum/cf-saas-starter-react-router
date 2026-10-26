import { Effect } from "effect";
import type { AnalyticsAdapter } from "../adapter";

export const noopAdapter: AnalyticsAdapter = {
  name: "none",
  send: () => Effect.void,
};
