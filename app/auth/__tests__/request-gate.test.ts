import { describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { createAuthClient } from "better-auth/client";
import { authRuleFor, clientKey, guardAuthRequest, rateLimitedResponse } from "../request-gate";
import { RateLimiter, type RateLimitRule } from "@/services/rate-limit";
import { RateLimitError } from "@/models/errors/rate-limit";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import {
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMITED_CODE,
  RATE_LIMITED_MESSAGE,
  RETRY_AFTER_HEADER,
  SHARED_CLIENT_KEY,
} from "@/lib/constants/rate-limit";

const ORIGIN = "http://localhost";

const request = (path: string, method = "POST", headers: HeadersInit = {}) =>
  new Request(`${ORIGIN}${path}`, { method, headers });

const overLimit = new RateLimitError({ rule: "signIn", retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS });

describe("authRuleFor", () => {
  it.each([
    ["/api/auth/sign-in/email", "signIn"],
    ["/api/auth/sign-in/social", "signIn"],
    ["/api/auth/sign-up/email", "signUp"],
    ["/api/auth/sign-out", "authApi"],
    ["/api/auth/request-password-reset", "authApi"],
    ["/api/auth/admin/ban-user", "authApi"],
  ])("puts a POST to %s under the %s rule", (path, rule) => {
    expect(authRuleFor(request(path))).toBe(rule);
  });

  it.each(["GET", "HEAD", "OPTIONS", "get"])(
    "never limits a %s, so reading the session is never refused",
    (method) => {
      expect(authRuleFor(request("/api/auth/sign-in/email", method))).toBeNull();
      expect(authRuleFor(request("/api/auth/get-session", method))).toBeNull();
    }
  );

  it.each(["PUT", "PATCH", "DELETE"])("limits a %s like a POST", (method) => {
    expect(authRuleFor(request("/api/auth/sign-in/email", method))).toBe("signIn");
  });

  it.each([
    ["/api/auth/sign-inx/email", "authApi"],
    ["/api/auth/sign-in-extra", "authApi"],
    ["/api/auth/sign-up-admin", "authApi"],
    ["/api/auth/other/sign-in/email", "authApi"],
  ])("does not give %s a sign-in or sign-up rule just because it starts alike", (path, rule) => {
    expect(authRuleFor(request(path))).toBe(rule);
  });

  it("matches a sign-in path in upper case to the sign-in rule, so a case change does not reach the looser bucket", () => {
    expect(authRuleFor(request("/api/auth/SIGN-IN/email"))).toBe("signIn");
  });

  it("ignores a query string when it picks the rule", () => {
    expect(authRuleFor(request("/api/auth/sign-up/email?next=/api/auth/x"))).toBe("signUp");
  });

  it.each(["/api/authx/sign-in/email", "/api/upload-file", "/api/auth"])(
    "gives no auth rule to %s, which is not under /api/auth/",
    (path) => {
      expect(authRuleFor(request(path))).toBeNull();
    }
  );
});

describe("clientKey", () => {
  it("keys on the cf-connecting-ip header", () => {
    expect(clientKey(request("/api/auth/sign-in/email", "POST", { [CLIENT_IP_HEADER]: "203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
  });

  it("ignores a client-set x-forwarded-for, which anyone can change per request", () => {
    expect(
      clientKey(request("/api/auth/sign-in/email", "POST", { "x-forwarded-for": "198.51.100.1" }))
    ).toBe(SHARED_CLIENT_KEY);
  });

  it.each([
    ["absent", {}],
    ["blank", { [CLIENT_IP_HEADER]: "  " }],
  ])("falls back to one shared key when the header is %s", (_label, headers) => {
    expect(clientKey(request("/api/auth/sign-in/email", "POST", headers))).toBe(SHARED_CLIENT_KEY);
  });
});

describe("guardAuthRequest", () => {
  const run = (req: Request, allow: boolean) => {
    const seen: Array<[RateLimitRule, string]> = [];
    const limiter = Layer.succeed(RateLimiter, {
      check: (rule, key) => {
        seen.push([rule, key]);
        return allow ? Effect.void : Effect.fail(overLimit);
      },
    });
    const result = Effect.runSync(Effect.either(guardAuthRequest(req).pipe(Effect.provide(limiter))));
    return { result, seen };
  };

  it("checks the request's rule with the client's key", () => {
    const { result, seen } = run(
      request("/api/auth/sign-up/email", "POST", { [CLIENT_IP_HEADER]: "203.0.113.10" }),
      true
    );
    expect(Either.isRight(result)).toBe(true);
    expect(seen).toEqual([["signUp", "203.0.113.10"]]);
  });

  it("passes on the limiter's refusal", () => {
    const { result } = run(request("/api/auth/sign-in/email"), false);
    expect(result).toEqual(Either.left(overLimit));
  });

  it("does not ask the limiter about a GET", () => {
    const { result, seen } = run(request("/api/auth/get-session", "GET"), false);
    expect(Either.isRight(result)).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe("rateLimitedResponse", () => {
  it("answers 429 with Retry-After and a JSON code and message", async () => {
    const response = rateLimitedResponse(overLimit);
    expect(response.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(response.headers.get(RETRY_AFTER_HEADER)).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ code: RATE_LIMITED_CODE, message: RATE_LIMITED_MESSAGE });
  });

  it("reads as error.code and error.message in Better Auth's client, so the form can show it", async () => {
    const client = createAuthClient({
      baseURL: ORIGIN,
      fetchOptions: { customFetchImpl: async () => rateLimitedResponse(overLimit) },
    });
    const { data, error } = await client.signIn.email({ email: "someone@example.test", password: "not-a-real-password" });
    expect(data).toBeNull();
    expect(error).toMatchObject({
      status: HTTP_TOO_MANY_REQUESTS,
      code: RATE_LIMITED_CODE,
      message: RATE_LIMITED_MESSAGE,
    });
  });
});
