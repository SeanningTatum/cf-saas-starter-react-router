import { describe, expect, it } from "vitest";
import { envVarOf, flagOf, GROUP_NAMES, itemById, SETUP_ITEMS } from "../setup-items";

describe("setup items", () => {
  it("has unique ids, flags and environment variable names", () => {
    expect(new Set(SETUP_ITEMS.map((item) => item.id)).size).toBe(SETUP_ITEMS.length);
    expect(new Set(SETUP_ITEMS.map(flagOf)).size).toBe(SETUP_ITEMS.length);
    expect(new Set(SETUP_ITEMS.map(envVarOf)).size).toBe(SETUP_ITEMS.length);
  });

  it("covers every item the ticket names", () => {
    const ids = SETUP_ITEMS.map((item) => item.id);
    for (const id of [
      "production-token",
      "preview-token",
      "staging-token",
      "auth-url",
      "auth-url-preview",
      "auth-url-staging",
      "trusted-origins",
      "turnstile-site-key",
      "turnstile-secret-key",
      "sentry-dsn",
      "posthog-key",
      "posthog-host",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("names flags and variables from the id", () => {
    const item = itemById("auth-url-preview");
    expect(item && flagOf(item)).toBe("--auth-url-preview");
    expect(item && envVarOf(item)).toBe("SETUP_AUTH_URL_PREVIEW");
  });

  it("marks only what a deploy cannot do without as required", () => {
    const required = SETUP_ITEMS.filter((item) => item.required).map((item) => item.id);
    expect(required.sort()).toEqual(["account-id", "auth-secret", "auth-url", "production-token"]);
  });

  it("sends secrets to secret stores and public values to variables", () => {
    for (const item of SETUP_ITEMS) {
      expect(item.secret).toBe(item.store.endsWith("secret") || item.store === "gh-env-secret");
    }
    expect(itemById("turnstile-site-key")?.store).toBe("wrangler-var");
    expect(itemById("turnstile-secret-key")?.store).toBe("wrangler-secret");
  });

  it("turns a service on only through its own companion variable", () => {
    expect(itemById("sentry-dsn")?.companion).toEqual({ name: "ERROR_REPORTER", value: "sentry" });
    expect(itemById("posthog-key")?.companion).toEqual({ name: "ANALYTICS_PROVIDER", value: "posthog" });
  });

  it("pairs the Turnstile keys per environment", () => {
    expect(itemById("turnstile-site-key-staging")?.pairWith).toBe("turnstile-secret-key-staging");
    expect(GROUP_NAMES).toContain("turnstile");
  });
});
