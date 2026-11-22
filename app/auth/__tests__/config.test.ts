import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { resolveAuthConfig, type AuthConfigSource, type AuthRuntimeOptions } from "../config";
import { AUTH_SECRET_MIN_LENGTH, DEV_ONLY_AUTH_SECRET } from "@/lib/constants/auth";
import { ConfigurationError } from "@/models/errors/repository";

const SECRET = "test-secret-not-real-0000000000000000";
const APP_URL = "https://app.example.test";

const resolve = (env: AuthConfigSource, options: AuthRuntimeOptions) =>
  Effect.runSync(Effect.either(resolveAuthConfig(env, options)));

const config = (env: AuthConfigSource, options: AuthRuntimeOptions) => {
  const result = resolve(env, options);
  if (Either.isLeft(result)) {
    return expect.unreachable(`expected a config, got ${result.left.field}`);
  }
  return result.right;
};

const failedField = (env: AuthConfigSource, options: AuthRuntimeOptions) => {
  const result = resolve(env, options);
  if (Either.isRight(result)) return expect.unreachable("expected a ConfigurationError");
  expect(result.left).toBeInstanceOf(ConfigurationError);
  expect(result.left.service).toBe("BetterAuth");
  return result.left.field;
};

const prod: AuthRuntimeOptions = { dev: false };
const dev: AuthRuntimeOptions = { dev: true, requestOrigin: "http://localhost:5173" };
const prodEnv: AuthConfigSource = { BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: APP_URL };

describe("resolveAuthConfig outside dev", () => {
  it("takes the base URL from BETTER_AUTH_URL, reduced to its origin", () => {
    const result = config({ ...prodEnv, BETTER_AUTH_URL: `${APP_URL}/some/path` }, prod);
    expect(result.baseURL).toBe(APP_URL);
    expect(result.secret).toBe(SECRET);
    expect(result.trustedOrigins).toEqual([]);
  });

  it("fails when BETTER_AUTH_URL is unset, rather than trusting the request origin", () => {
    expect(
      failedField(
        { BETTER_AUTH_SECRET: SECRET },
        { dev: false, requestOrigin: "https://app.example.test" }
      )
    ).toBe("BETTER_AUTH_URL");
  });

  it("ignores a spoofed request origin and keeps BETTER_AUTH_URL", () => {
    const result = config(prodEnv, { dev: false, requestOrigin: "https://spoofed.test" });
    expect(result.baseURL).toBe(APP_URL);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["not a URL", "app.example.test"],
    ["a scheme with no host", "https://"],
    ["not http or https", "ftp://app.example.test"],
    ["a javascript URL", "javascript:alert(1)"],
  ])("fails when BETTER_AUTH_URL is %s", (_label, value) => {
    expect(failedField({ ...prodEnv, BETTER_AUTH_URL: value }, prod)).toBe("BETTER_AUTH_URL");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["blank", "  "],
    ["one character under the minimum", "s".repeat(AUTH_SECRET_MIN_LENGTH - 1)],
    ["the placeholder left in from .dev.vars.example", "paste-openssl-rand-hex-32"],
  ])("fails when BETTER_AUTH_SECRET is %s, rather than signing with a weak secret", (_label, value) => {
    expect(failedField({ ...prodEnv, BETTER_AUTH_SECRET: value }, prod)).toBe(
      "BETTER_AUTH_SECRET"
    );
  });

  it("accepts a secret of exactly the minimum length", () => {
    const secret = "s".repeat(AUTH_SECRET_MIN_LENGTH);
    expect(config({ ...prodEnv, BETTER_AUTH_SECRET: secret }, prod).secret).toBe(secret);
  });

  it("never accepts the dev-only secret outside dev, even when the env holds it", () => {
    expect(failedField({ ...prodEnv, BETTER_AUTH_SECRET: DEV_ONLY_AUTH_SECRET }, prod)).toBe(
      "BETTER_AUTH_SECRET"
    );
  });

  it.each([
    ["an https URL", "https://app.example.test"],
    ["http on localhost", "http://localhost"],
    ["http on localhost with a port", "http://localhost:4173"],
    ["http on 127.0.0.1 with a port", "http://127.0.0.1:8787"],
  ])("accepts %s as BETTER_AUTH_URL", (_label, value) => {
    expect(config({ ...prodEnv, BETTER_AUTH_URL: value }, prod).baseURL).toBe(new URL(value).origin);
  });

  it.each([
    ["a public host", "http://app.example.test"],
    ["a host that only starts with localhost", "http://localhost.example.test"],
    ["a private address", "http://10.0.0.5"],
  ])("refuses an http BETTER_AUTH_URL on %s, which would turn Secure cookies off", (_label, value) => {
    expect(failedField({ ...prodEnv, BETTER_AUTH_URL: value }, prod)).toBe("BETTER_AUTH_URL");
  });
});

describe("resolveAuthConfig in dev", () => {
  it("follows the request origin, even when BETTER_AUTH_URL is set", () => {
    const result = config({ ...prodEnv, BETTER_AUTH_URL: "https://other.test" }, dev);
    expect(result.baseURL).toBe("http://localhost:5173");
  });

  it("falls back to BETTER_AUTH_URL when no request origin is given", () => {
    expect(config(prodEnv, { dev: true }).baseURL).toBe(APP_URL);
    expect(config(prodEnv, { dev: true, requestOrigin: "" }).baseURL).toBe(APP_URL);
  });

  it("fails with neither a request origin nor BETTER_AUTH_URL", () => {
    expect(failedField({ BETTER_AUTH_SECRET: SECRET }, { dev: true })).toBe("BETTER_AUTH_URL");
  });

  it("uses the dev-only secret when BETTER_AUTH_SECRET is unset or empty", () => {
    expect(config({}, dev).secret).toBe(DEV_ONLY_AUTH_SECRET);
    expect(config({ BETTER_AUTH_SECRET: "" }, dev).secret).toBe(DEV_ONLY_AUTH_SECRET);
  });

  it("keeps a set BETTER_AUTH_SECRET over the dev-only one", () => {
    expect(config({ BETTER_AUTH_SECRET: SECRET }, dev).secret).toBe(SECRET);
  });
});

describe("resolveAuthConfig trusted origins", () => {
  const origins = (value: string | undefined, options: AuthRuntimeOptions = prod) =>
    config({ ...prodEnv, AUTH_TRUSTED_ORIGINS: value }, options).trustedOrigins;
  const failsOn = (value: string, options: AuthRuntimeOptions = prod) =>
    failedField({ ...prodEnv, AUTH_TRUSTED_ORIGINS: value }, options);

  it("is empty when unset or empty, so only the base URL is trusted", () => {
    expect(origins(undefined)).toEqual([]);
    expect(origins("")).toEqual([]);
  });

  it("drops whitespace and empty entries", () => {
    expect(origins(" https://a.test , ,https://b.test:8443/,, ")).toEqual([
      "https://a.test",
      "https://b.test:8443",
    ]);
  });

  it.each([
    ["a subdomain wildcard", "https://*.example.com"],
    ["a Workers per-PR preview host", "https://*-my-app-preview.my-team.workers.dev"],
    ["every worker on one workers.dev account", "https://*.my-team.workers.dev"],
    ["a wildcard with a port", "https://*.example.com:8443"],
  ])("accepts %s, as Better Auth matches it", (_label, entry) => {
    expect(origins(entry)).toEqual([entry]);
  });

  it("drops a trailing slash and lowercases a wildcard entry, so it matches a request origin", () => {
    expect(origins("HTTPS://*.Example.COM/")).toEqual(["https://*.example.com"]);
  });

  it("allows an http wildcard in dev only", () => {
    expect(origins("http://*.local.example.test:5173", dev)).toEqual([
      "http://*.local.example.test:5173",
    ]);
    expect(failsOn("http://*.local.example.test:5173")).toBe("AUTH_TRUSTED_ORIGINS");
  });

  it("parses trusted origins in dev too", () => {
    expect(origins("https://*.preview.example.test", dev)).toEqual([
      "https://*.preview.example.test",
    ]);
    expect(failsOn("https://*", dev)).toBe("AUTH_TRUSTED_ORIGINS");
  });

  it.each([
    ["a host that is only a wildcard", "https://*"],
    ["a wildcard over a top-level domain", "https://*.com"],
    ["a wildcard over all of workers.dev", "https://*.workers.dev"],
    ["a wildcard over all of pages.dev", "https://*.pages.dev"],
    ["a name suffix straight on workers.dev", "https://*-my-app.workers.dev"],
    ["a name suffix on a top-level domain", "https://*-app.com"],
    ["a wildcard glued to a name", "https://*example.com"],
    ["a wildcard at the end of the host", "https://app*"],
    ["a wildcard inside the host", "https://a.*.example.com"],
    ["two wildcards", "https://*.*.example.com"],
    ["a host of wildcards and dots", "https://*.*"],
    ["a bare wildcard with a port", "http://*:8080"],
    ["a wildcard with a path", "https://*.preview.example.test/admin"],
    ["a wildcard in the scheme", "*://app.example.test"],
    ["no scheme", "app.example.test"],
    ["a wildcard with no scheme", "*.example.test"],
    ["a scheme other than http or https", "ftp://files.example.test"],
    ["a path on an exact origin", "https://a.test/admin"],
    ["a query on an exact origin", "https://a.test/?next=1"],
    ["credentials in the URL", "https://user:pw@a.test"],
  ])("refuses %s, so one bad entry cannot trust every site", (_label, entry) => {
    expect(failsOn(`https://ok.test,${entry}`)).toBe("AUTH_TRUSTED_ORIGINS");
  });
});

describe("resolveAuthConfig secure cookies", () => {
  it("turns on secure cookies for an https base URL", () => {
    expect(config(prodEnv, prod).secureCookies).toBe(true);
  });

  it("leaves secure cookies off for an http base URL, so local dev can sign in", () => {
    expect(config({ ...prodEnv, BETTER_AUTH_URL: "http://localhost:8787" }, prod).secureCookies).toBe(
      false
    );
    expect(config({}, dev).secureCookies).toBe(false);
  });
});
