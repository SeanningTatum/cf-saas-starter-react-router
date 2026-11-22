import { describe, expect, it } from "vitest";
import {
  AUTH_API_PATH_PREFIX,
  AUTH_RULE_PATH_PREFIXES,
  RATE_LIMIT_BINDINGS,
  RATE_LIMIT_PERIOD_MS,
  RATE_LIMIT_PERIOD_SECONDS,
  SHARED_CLIENT_KEY,
  msLeftInRateLimitWindow,
} from "../rate-limit";

const WRANGLER_PERIODS = [10, 60];
const WINDOW_MS = RATE_LIMIT_PERIOD_MS;
const SOME_WINDOW_START_MS = 1_700_000_040_000;

describe("rate-limit constants", () => {
  it("gives every rule its own binding, so two rules never share one counter", () => {
    const bindings = Object.values(RATE_LIMIT_BINDINGS);
    expect(new Set(bindings).size).toBe(bindings.length);
  });

  it("uses a period the Workers binding supports", () => {
    expect(WRANGLER_PERIODS).toContain(RATE_LIMIT_PERIOD_SECONDS);
  });

  it("keeps each named auth prefix under the auth API prefix and ending in a slash, so it cannot match a longer path name", () => {
    for (const { prefix } of AUTH_RULE_PATH_PREFIXES) {
      expect(prefix.startsWith(AUTH_API_PATH_PREFIX)).toBe(true);
      expect(prefix.endsWith("/")).toBe(true);
      expect(prefix).toBe(prefix.toLowerCase());
    }
  });

  it("uses a shared key that can never be a client IP", () => {
    expect(SHARED_CLIENT_KEY).not.toMatch(/^[\d.:a-f]+$/i);
  });
});

describe("msLeftInRateLimitWindow", () => {
  it("counts the whole window at its first millisecond and one at its last", () => {
    expect(SOME_WINDOW_START_MS % WINDOW_MS).toBe(0);
    expect(msLeftInRateLimitWindow(SOME_WINDOW_START_MS)).toBe(WINDOW_MS);
    expect(msLeftInRateLimitWindow(SOME_WINDOW_START_MS + WINDOW_MS - 1)).toBe(1);
  });

  it("starts over at the next window, so a wait never runs past one period", () => {
    expect(msLeftInRateLimitWindow(SOME_WINDOW_START_MS + WINDOW_MS)).toBe(WINDOW_MS);
    expect(msLeftInRateLimitWindow(SOME_WINDOW_START_MS + WINDOW_MS / 2)).toBe(WINDOW_MS / 2);
  });
});
