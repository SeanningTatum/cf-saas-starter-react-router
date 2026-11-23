import { describe, expect, it } from "vitest";
import {
  AUTH_SECRET_MIN_LENGTH,
  DEV_ONLY_AUTH_SECRET,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  WILDCARD_ORIGIN_PATTERN,
} from "../auth";

describe("auth constants", () => {
  it("keeps the password floor under the cap, so no password can pass both", () => {
    expect(PASSWORD_MIN_LENGTH).toBeLessThan(PASSWORD_MAX_LENGTH);
  });

  it("renews a session before it ends, so an active user stays signed in", () => {
    expect(SESSION_UPDATE_AGE_SECONDS).toBeLessThan(SESSION_EXPIRES_IN_SECONDS);
  });

  it("keeps the dev-only secret plainly fake and long enough for Better Auth", () => {
    expect(DEV_ONLY_AUTH_SECRET.length).toBeGreaterThanOrEqual(AUTH_SECRET_MIN_LENGTH);
    expect(DEV_ONLY_AUTH_SECRET).toMatch(/^dev-only-/);
    expect(DEV_ONLY_AUTH_SECRET).toMatch(/^[a-z-]+$/);
  });
});

describe("WILDCARD_ORIGIN_PATTERN", () => {
  const groupsOf = (entry: string) => WILDCARD_ORIGIN_PATTERN.exec(entry)?.groups;

  it("splits a wildcard entry into its origin, scheme and fixed domain", () => {
    expect(groupsOf("https://*.preview.example.test:8443/")).toEqual({
      origin: "https://*.preview.example.test:8443",
      scheme: "https",
      domain: "preview.example.test",
    });
  });

  it("takes the fixed domain after a name suffix, not the suffix itself", () => {
    expect(groupsOf("https://*-my-app-preview.my-team.workers.dev")?.domain).toBe(
      "my-team.workers.dev",
    );
  });

  it.each([
    "https://*",
    "https://*.com",
    "https://*example.com",
    "https://app*",
    "https://a.*.example.com",
    "https://*.*.example.com",
    "https://*.preview.test/path",
    "ftp://*.preview.test",
  ])("does not match %s, so the host cannot be left open", (entry) => {
    expect(WILDCARD_ORIGIN_PATTERN.test(entry)).toBe(false);
  });
});
