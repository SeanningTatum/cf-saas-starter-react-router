import { describe, expect, it } from "vitest";
import { TURNSTILE_PUBLISHED_TEST_KEYS } from "../../../app/lib/constants/turnstile";
import { checkValue, TURNSTILE_PAIR_PROBLEM } from "../setup-validate";

describe("checkValue", () => {
  it("refuses an auth secret under 32 characters and accepts one of 64", () => {
    expect(checkValue("auth-secret", "short")).toMatch(/32/);
    expect(checkValue("auth-secret", "a".repeat(64))).toBeUndefined();
  });

  it("refuses the published auth secrets that a deployed build rejects", () => {
    expect(checkValue("auth-secret", "better-auth-secret-12345678901234567890")).toBeDefined();
  });

  it("takes an https auth URL and a localhost one, and refuses a plain http host", () => {
    expect(checkValue("auth-url", "https://app.example.com")).toBeUndefined();
    expect(checkValue("auth-url", "http://localhost:4173")).toBeUndefined();
    expect(checkValue("auth-url", "http://app.example.com")).toBeDefined();
    expect(checkValue("auth-url", "not a url")).toBeDefined();
  });

  it("holds trusted origins to the same rules the Worker applies", () => {
    expect(checkValue("origins", "https://a.example.com,https://*.example.com")).toBeUndefined();
    expect(checkValue("origins", "https://*.workers.dev")).toBeDefined();
    expect(checkValue("origins", "https://a.example.com/path")).toBeDefined();
  });

  it("refuses a published Turnstile test key and accepts another", () => {
    const [published] = TURNSTILE_PUBLISHED_TEST_KEYS;
    expect(checkValue("turnstile-key", published ?? "")).toMatch(/test key/);
    expect(checkValue("turnstile-key", "0x4AAAAAAAreal")).toBeUndefined();
  });

  it("wants an https DSN with a project id", () => {
    expect(checkValue("dsn", "https://abc@o1.ingest.sentry.io/42")).toBeUndefined();
    expect(checkValue("dsn", "http://abc@o1.ingest.sentry.io/42")).toBeDefined();
    expect(checkValue("dsn", "nonsense")).toBeDefined();
  });

  it("checks tokens, account ids, https URLs and text", () => {
    expect(checkValue("token", "x".repeat(40))).toBeUndefined();
    expect(checkValue("token", "x y")).toBeDefined();
    expect(checkValue("account-id", "0".repeat(32))).toBeUndefined();
    expect(checkValue("account-id", "nope")).toBeDefined();
    expect(checkValue("https-url", "https://us.i.posthog.com")).toBeUndefined();
    expect(checkValue("https-url", "http://us.i.posthog.com")).toBeDefined();
    expect(checkValue("text", "   ")).toBeDefined();
  });

  it("never repeats the value it refuses", () => {
    const secretish = "http://leak.example.com/SECRETVALUE";
    expect(checkValue("auth-url", secretish)).not.toContain("SECRETVALUE");
    expect(TURNSTILE_PAIR_PROBLEM).not.toContain("SECRETVALUE");
  });
});
