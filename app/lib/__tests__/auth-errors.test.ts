import { describe, expect, it } from "vitest";
import { authRefusalFor, retryWaitSeconds } from "../auth-errors";

describe("authRefusalFor", () => {
  it("reads a 429 as rate limited even when the body has no code", () => {
    expect(authRefusalFor({ status: 429 }, true)).toBe("rate_limited");
    expect(authRefusalFor({ status: 429 }, false)).toBe("rate_limited");
  });

  it("reads the TOO_MANY_REQUESTS code as rate limited whatever the status", () => {
    expect(authRefusalFor({ status: 400, code: "TOO_MANY_REQUESTS" }, false)).toBe("rate_limited");
  });

  it("asks for the check again when the token is missing or rejected", () => {
    expect(authRefusalFor({ status: 400, code: "MISSING_RESPONSE" }, true)).toBe("captcha_failed");
    expect(authRefusalFor({ status: 403, code: "VERIFICATION_FAILED" }, true)).toBe(
      "captcha_failed",
    );
  });

  it("says the check is unavailable on the captcha plugin's 500", () => {
    expect(authRefusalFor({ status: 500, code: "UNKNOWN_ERROR" }, true)).toBe(
      "captcha_unavailable",
    );
  });

  it("does not blame the check when Turnstile is off on this page", () => {
    expect(authRefusalFor({ status: 403, code: "VERIFICATION_FAILED" }, false)).toBeNull();
    expect(authRefusalFor({ status: 500, code: "UNKNOWN_ERROR" }, false)).toBeNull();
  });

  it("leaves wrong-password and other errors to the server's own message", () => {
    expect(authRefusalFor({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, true)).toBeNull();
    expect(authRefusalFor({ status: 500 }, true)).toBeNull();
    expect(authRefusalFor({ status: 500, code: "INTERNAL" }, true)).toBeNull();
  });

  it("maps by code, not by the message text", () => {
    const error = { status: 403, code: "VERIFICATION_FAILED", message: "Too many attempts" };
    expect(authRefusalFor(error, true)).toBe("captcha_failed");
  });
});

const refused = (status: number, retryAfter: string | null) => ({
  status,
  headers: new Headers(retryAfter === null ? {} : { "Retry-After": retryAfter }),
});

describe("retryWaitSeconds", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");

  it("reads a delay in seconds from a 429's Retry-After", () => {
    expect(retryWaitSeconds(refused(429, "60"), now)).toBe(60);
    expect(retryWaitSeconds(refused(429, " 7 "), now)).toBe(7);
  });

  it("reads an HTTP date as the seconds left until it, rounded up", () => {
    expect(retryWaitSeconds(refused(429, "Mon, 23 Nov 2026 12:00:42 GMT"), now)).toBe(42);
    expect(retryWaitSeconds(refused(429, "Mon, 23 Nov 2026 12:00:00 GMT"), now - 1)).toBe(1);
  });

  it("gives no wait for a date already past, a zero delay, a missing or unreadable header", () => {
    expect(retryWaitSeconds(refused(429, "Mon, 23 Nov 2026 11:59:00 GMT"), now)).toBeNull();
    expect(retryWaitSeconds(refused(429, "0"), now)).toBeNull();
    expect(retryWaitSeconds(refused(429, null), now)).toBeNull();
    expect(retryWaitSeconds(refused(429, "soon"), now)).toBeNull();
    expect(retryWaitSeconds(refused(429, "-5"), now)).toBeNull();
  });

  it("ignores Retry-After on any status but 429, so a 503 or a wrong password never locks the form", () => {
    expect(retryWaitSeconds(refused(503, "60"), now)).toBeNull();
    expect(retryWaitSeconds(refused(401, "60"), now)).toBeNull();
  });
});
