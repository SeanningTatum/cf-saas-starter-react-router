import { Effect } from "effect";
import type { AnalyticsAdapter } from "../adapter";
import { loggers } from "@/lib/logger";

export const consoleAdapter: AnalyticsAdapter = {
  name: "console",
  send: (batch) =>
    Effect.sync(() => {
      for (const e of batch) {
        loggers.server.info({ analytics: e }, `analytics event: ${e.event}`);
      }
    }),
};
