import { Effect } from "effect";
import type { ErrorReporterAdapter } from "../adapter";

export const noopAdapter: ErrorReporterAdapter = {
  name: "none",
  send: () => Effect.void,
};
