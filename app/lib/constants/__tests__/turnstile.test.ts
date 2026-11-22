import { describe, expect, it } from "vitest";
import {
  TURNSTILE_ORIGIN,
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

  it("lists both test pairs among the published test keys, so a non-dev build refuses them", () => {
    expect(TURNSTILE_PUBLISHED_TEST_KEYS).toEqual(
      expect.arrayContaining([
        TURNSTILE_TEST_SITE_KEY,
        TURNSTILE_TEST_SECRET_KEY,
        TURNSTILE_TEST_ALWAYS_FAIL_SITE_KEY,
        TURNSTILE_TEST_ALWAYS_FAIL_SECRET_KEY,
      ])
    );
  });
});
