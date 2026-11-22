import { Effect } from "effect";
import type { ErrorReport, ErrorReporterAdapter } from "../adapter";
import { loggers } from "@/lib/logger";

const logReport = ({ message, level, ...fields }: ErrorReport): void => {
  const line = { errorReport: fields };
  if (level === "error") loggers.server.error(line, message);
  else loggers.server.warn(line, message);
};

export const consoleAdapter: ErrorReporterAdapter = {
  name: "console",
  send: (batch) => Effect.sync(() => batch.forEach(logReport)),
};
