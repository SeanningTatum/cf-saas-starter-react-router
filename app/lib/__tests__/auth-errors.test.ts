import { describe, expect, it } from "vitest";
import { authRefusalFor } from "../auth-errors";

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
