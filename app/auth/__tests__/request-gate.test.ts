import { describe, expect, it } from "vitest";
import { Effect, Either, Layer, Logger } from "effect";
import { createAuthClient } from "better-auth/client";
import {
  addressKey,
  authGate,
  authRuleFor,
  clientKey,
  guardAuthRequest,
  rateLimitedResponse,
} from "../request-gate";
import { AuthApi, type AuthApiShape } from "@/services/auth";
import { TURNSTILE_OFF_WARNING, TURNSTILE_TEST_SITE_KEY } from "@/lib/constants/turnstile";
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

  it.each([
    ["/api/auth//sign-in/email", "signIn"],
    ["/api//auth/sign-in//email", "signIn"],
    ["/api/auth/sign-in/email/", "signIn"],
    ["/api/auth/sign-in/", "signIn"],
    ["/api/auth/sign-up//email/", "signUp"],
    ["/api/auth/sign%2Din/email", "signIn"],
    ["/api/auth/sign%2din/email", "signIn"],
    ["/api/auth/SIGN%2DUP/email", "signUp"],
  ])("puts %s under the %s rule, so a doubled slash, trailing slash or encoded dash cannot reach the looser bucket", (path, rule) => {
    expect(authRuleFor(request(path))).toBe(rule);
  });

  it("keeps an encoded slash encoded, so it does not open a new path segment", () => {
    expect(authRuleFor(request("/api/auth/sign-in%2Femail"))).toBe("authApi");
  });

  it("puts the bare auth root under the general auth rule, so it is not left unlimited", () => {
    expect(authRuleFor(request("/api/auth"))).toBe("authApi");
    expect(authRuleFor(request("/api/auth/"))).toBe("authApi");
  });

  it.each(["/api/authx/sign-in/email", "/api/upload-file", "/api/auth-other"])(
    "gives no auth rule to %s, which is not under /api/auth/",
    (path) => {
      expect(authRuleFor(request(path))).toBeNull();
    }
  );
});

describe("addressKey", () => {
  it.each([
    ["203.0.113.9", "203.0.113.9"],
    ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", "2001:db8:85a3:0::/64"],
    ["2001:db8:85a3:0:ffff:8a2e:370:7334", "2001:db8:85a3:0::/64"],
    ["2001:db8:85a3::8a2e:370:7334", "2001:db8:85a3:0::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:db8::", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::", "0:0:0:0::/64"],
    ["2001:DB8:ABCD:12::1", "2001:db8:abcd:12::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["64:ff9b::192.0.2.33", "64:ff9b:0:0::/64"],
    ["::ffff:203.0.113.9", "203.0.113.9"],
    ["::FFFF:203.0.113.9", "203.0.113.9"],
    ["0:0:0:0:0:ffff:cb00:7109", "203.0.113.9"],
  ])("keys %s as %s", (raw, key) => {
    expect(addressKey(raw)).toBe(key);
  });

  it("gives every address in one /64 the same key, so a subscriber cannot rotate through its own block", () => {
    expect(addressKey("2001:db8:1:2:aaaa::1")).toBe(addressKey("2001:db8:1:2:bbbb:cccc:dddd:eeee"));
    expect(addressKey("2001:db8:1:2::1")).not.toBe(addressKey("2001:db8:1:3::1"));
  });

  it("gives a mapped IPv4 address the same key as the plain address", () => {
    expect(addressKey("::ffff:198.51.100.7")).toBe(addressKey("198.51.100.7"));
  });

  it.each([
    "not-an-ip",
    "203.0.113.256",
    "203.0.113",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "1::2::3",
    "12345::1",
    "::ffff:203.0.113.999",
    "2001:db8::g",
  ])("keeps %s as sent when it parses as neither IPv4 nor IPv6", (raw) => {
    expect(addressKey(raw)).toBe(raw);
  });
});

describe("clientKey", () => {
  it("keys on the cf-connecting-ip header", () => {
    expect(clientKey(request("/api/auth/sign-in/email", "POST", { [CLIENT_IP_HEADER]: "203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
  });

  it("keys an IPv6 header on its /64, so one subscriber's block shares one count", () => {
    expect(
      clientKey(request("/api/auth/sign-in/email", "POST", { [CLIENT_IP_HEADER]: " 2001:db8:1:2:3:4:5:6 " }))
    ).toBe("2001:db8:1:2::/64");
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

describe("authGate", () => {
  const gate = (req: Request, { dev, siteKey, allow = true }: { dev: boolean; siteKey: string | null; allow?: boolean }) => {
    const warnings: unknown[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(RateLimiter, { check: () => (allow ? Effect.void : Effect.fail(overLimit)) }),
      Layer.succeed(AuthApi, { turnstileSiteKey: siteKey } as unknown as AuthApiShape),
      Logger.replace(
        Logger.defaultLogger,
        Logger.make(({ logLevel, message }) => {
          if (logLevel.label === "WARN") warnings.push(message);
        })
      )
    );
    const refusal = Effect.runSync(authGate(req, dev).pipe(Effect.provide(layer)));
    return { refusal, warnings: warnings.flat() };
  };

  it.each(["/api/auth/sign-in/email", "/api/auth/sign-up/email"])(
    "warns once, naming both key variables, when a non-dev build takes a POST to %s with Turnstile off",
    (path) => {
      const { refusal, warnings } = gate(request(path), { dev: false, siteKey: null });
      expect(refusal).toBeNull();
      expect(warnings).toEqual([TURNSTILE_OFF_WARNING]);
      expect(TURNSTILE_OFF_WARNING).toContain("TURNSTILE_SITE_KEY");
      expect(TURNSTILE_OFF_WARNING).toContain("TURNSTILE_SECRET_KEY");
    }
  );

  it("stays quiet in a dev build, where Turnstile off is the developer's choice", () => {
    expect(gate(request("/api/auth/sign-in/email"), { dev: true, siteKey: null }).warnings).toEqual([]);
  });

  it("stays quiet when Turnstile is on", () => {
    expect(
      gate(request("/api/auth/sign-in/email"), { dev: false, siteKey: TURNSTILE_TEST_SITE_KEY }).warnings
    ).toEqual([]);
  });

  it.each([
    ["a sign-out POST", request("/api/auth/sign-out")],
    ["a session read", request("/api/auth/get-session", "GET")],
  ])("stays quiet on %s, which Turnstile does not guard", (_label, req) => {
    expect(gate(req, { dev: false, siteKey: null }).warnings).toEqual([]);
  });

  it("answers an over-limit request with the 429 response and no warning", () => {
    const { refusal, warnings } = gate(request("/api/auth/sign-in/email"), {
      dev: false,
      siteKey: null,
      allow: false,
    });
    expect(refusal?.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(warnings).toEqual([]);
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
