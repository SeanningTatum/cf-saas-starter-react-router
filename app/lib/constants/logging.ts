export const LOG_LEVEL_VALUE = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

export const LOG_LEVEL_COLORS = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
} as const;

export const ANSI_RESET = "\x1b[0m";

export const SHORT_REQUEST_ID_LENGTH = 8;
