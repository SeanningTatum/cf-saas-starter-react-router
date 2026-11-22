import { describe, expect, it } from "vitest";
import {
  AUTH_API_PATH_PREFIX,
  AUTH_RULE_PATH_PREFIXES,
  RATE_LIMIT_BINDINGS,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMITED_MESSAGE,
  SHARED_CLIENT_KEY,
  UNLIMITED_METHODS,
  UPLOAD_RATE_LIMITED_MESSAGE,
} from "../rate-limit";

const WRANGLER_PERIODS = [10, 60];

describe("rate-limit constants", () => {
  it("gives every rule its own binding, so two rules never share one counter", () => {
    const bindings = Object.values(RATE_LIMIT_BINDINGS);
    expect(new Set(bindings).size).toBe(bindings.length);
    expect(Object.keys(RATE_LIMIT_BINDINGS).sort()).toEqual(["authApi", "signIn", "signUp", "upload"]);
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

  it("leaves only read-only methods unlimited", () => {
    expect([...UNLIMITED_METHODS].sort()).toEqual(["GET", "HEAD", "OPTIONS"]);
  });

  it("uses a shared key that can never be a client IP", () => {
    expect(SHARED_CLIENT_KEY).not.toMatch(/^[\d.:a-f]+$/i);
  });

  it("tells the user to wait, in words the forms can show as they are", () => {
    expect(RATE_LIMITED_MESSAGE).toMatch(/wait/i);
    expect(UPLOAD_RATE_LIMITED_MESSAGE).toMatch(/wait/i);
  });
});
