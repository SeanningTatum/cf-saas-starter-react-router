import { describe, expect, it } from "vitest";
import {
  TURNSTILE_ALWAYS_PASS_TEST_KEYS,
  TURNSTILE_ORIGIN,
  TURNSTILE_PROTECTED_ENDPOINTS,
  TURNSTILE_PUBLISHED_TEST_KEYS,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_ALWAYS_FAIL_SECRET_KEY,
  TURNSTILE_TEST_ALWAYS_FAIL_SITE_KEY,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
} from "../turnstile";

describe("turnstile constants", () => {
  it("loads the widget script and calls siteverify on the one origin the CSP allows", () => {
    expect(new URL(TURNSTILE_SCRIPT_URL).origin).toBe(TURNSTILE_ORIGIN);
    expect(new URL(TURNSTILE_SITEVERIFY_URL).origin).toBe(TURNSTILE_ORIGIN);
  });

  it("renders the widget explicitly, so the form decides where and when it appears", () => {
    expect(new URL(TURNSTILE_SCRIPT_URL).searchParams.get("render")).toBe("explicit");
  });

  it("guards exactly email sign-in and email sign-up", () => {
    expect([...TURNSTILE_PROTECTED_ENDPOINTS].sort()).toEqual(["/sign-in/email", "/sign-up/email"]);
  });

  it("lists both test pairs among the published test keys, so a non-dev build refuses them", () => {
    expect(TURNSTILE_PUBLISHED_TEST_KEYS).toEqual(
      expect.arrayContaining([
        TURNSTILE_TEST_SITE_KEY,
        TURNSTILE_TEST_SECRET_KEY,
        TURNSTILE_TEST_ALWAYS_FAIL_SITE_KEY,
        TURNSTILE_TEST_ALWAYS_FAIL_SECRET_KEY,
      ])
    );
    expect(TURNSTILE_ALWAYS_PASS_TEST_KEYS).toEqual({
      siteKey: TURNSTILE_TEST_SITE_KEY,
      secretKey: TURNSTILE_TEST_SECRET_KEY,
    });
  });
});
