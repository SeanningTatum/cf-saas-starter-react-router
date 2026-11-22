import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { resolveAuthConfig, type AuthConfigSource } from "../config";
import { createAuth } from "../server";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_EXPIRES_IN_SECONDS,
} from "@/lib/constants/auth";
import { startRealApp, type RealApp } from "@/trpc/__tests__/real-d1";

const SECRET = "server-test-secret-not-real-000000000000";
const PASSWORD = "a".repeat(PASSWORD_MIN_LENGTH);
const SESSION_COOKIE = "better-auth.session_token";
const EXPIRY_TOLERANCE_MS = 60_000;

let app: RealApp;
let emailCount = 0;

beforeAll(async () => {
  app = await startRealApp();
}, 60_000);

afterAll(async () => {
  await app?.dispose();
});

const nextEmail = () => `server-test-${++emailCount}@example.test`;

const authFor = (env: AuthConfigSource) =>
  createAuth(
    app.db,
    Effect.runSync(resolveAuthConfig({ BETTER_AUTH_SECRET: SECRET, ...env }, { dev: false }))
  );

const post = (baseURL: string, path: string, body: unknown, headers: HeadersInit = {}) =>
  new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const sessionCookie = (response: Response) =>
  response.headers.getSetCookie().find((cookie) => cookie.includes(`${SESSION_COOKIE}=`));

const signUpThenIn = async (auth: ReturnType<typeof authFor>, baseURL: string) => {
  const email = nextEmail();
  await auth.api.signUpEmail({ body: { name: "Server Test", email, password: PASSWORD } });
  const response = await auth.handler(post(baseURL, "/sign-in/email", { email, password: PASSWORD }));
  expect(response.status).toBe(200);
  return response;
};

describe("createAuth password policy", () => {
  const signUp = (password: string) =>
    authFor({ BETTER_AUTH_URL: "http://localhost" }).api.signUpEmail({
      body: { name: "Server Test", email: nextEmail(), password },
    });

  it("refuses a password one character under the minimum", async () => {
    await expect(signUp("a".repeat(PASSWORD_MIN_LENGTH - 1))).rejects.toMatchObject({
      body: { code: "PASSWORD_TOO_SHORT" },
    });
  });

  it("refuses a password one character over the maximum, so a huge body cannot tie up hashing", async () => {
    await expect(signUp("a".repeat(PASSWORD_MAX_LENGTH + 1))).rejects.toMatchObject({
      body: { code: "PASSWORD_TOO_LONG" },
    });
  });

  it("accepts a password of exactly the minimum length", async () => {
    const result = await signUp(PASSWORD);
    expect(result.user.id).toBeTruthy();
  });
});

describe("createAuth session policy", () => {
  it("gives a new session the configured lifetime, so a longer default cannot slip in", async () => {
    const auth = authFor({ BETTER_AUTH_URL: "http://localhost" });
    const before = Date.now();
    const result = await auth.api.signUpEmail({
      body: { name: "Server Test", email: nextEmail(), password: PASSWORD },
    });
    const row = await app.db
      .prepare("SELECT expires_at AS expiresAt FROM session WHERE token = ?")
      .bind(result.token)
      .first<{ expiresAt: number }>();
    const expected = before + SESSION_EXPIRES_IN_SECONDS * 1000;
    expect(row).not.toBeNull();
    expect(Math.abs(Number(row?.expiresAt) - expected)).toBeLessThan(EXPIRY_TOLERANCE_MS);
  });
});

describe("createAuth session cookie", () => {
  it("is HttpOnly and SameSite=Lax over http, without Secure so local sign-in works", async () => {
    const baseURL = "http://localhost";
    const cookie = sessionCookie(await signUpThenIn(authFor({ BETTER_AUTH_URL: baseURL }), baseURL));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it("is Secure with the __Secure- prefix behind an https base URL, so it never travels in clear", async () => {
    const baseURL = "https://app.example.test";
    const cookie = sessionCookie(await signUpThenIn(authFor({ BETTER_AUTH_URL: baseURL }), baseURL));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(new RegExp(`^__Secure-${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
  });
});

describe("createAuth origin check", () => {
  const baseURL = "https://app.example.test";
  const auth = () =>
    authFor({
      BETTER_AUTH_URL: baseURL,
      AUTH_TRUSTED_ORIGINS:
        "https://admin.example.test, https://*.preview.example.test, https://*-my-app-preview.my-team.workers.dev",
    });

  const updateNameFrom = async (origin: string) => {
    const instance = auth();
    const signIn = await signUpThenIn(instance, baseURL);
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return instance.handler(
      post(baseURL, "/update-user", { name: "Renamed" }, { cookie, origin })
    );
  };

  it("refuses a cookie-carrying change from an origin that is not trusted", async () => {
    const response = await updateNameFrom("https://elsewhere.test");
    expect(response.status).toBe(403);
  });

  it("refuses a look-alike of a wildcard origin", async () => {
    const response = await updateNameFrom("https://preview.example.test.elsewhere.test");
    expect(response.status).toBe(403);
  });

  it("refuses a host that ends with a name-suffix wildcard's name but sits on another account", async () => {
    const response = await updateNameFrom("https://abc123-my-app-preview.other-team.workers.dev");
    expect(response.status).toBe(403);
  });

  it.each([
    ["the base URL", baseURL],
    ["an exact trusted origin", "https://admin.example.test"],
    ["a host matched by a wildcard origin", "https://pr-12.preview.example.test"],
    ["a Workers preview host matched by a name-suffix wildcard", "https://abc123-my-app-preview.my-team.workers.dev"],
  ])("lets %s through", async (_label, origin) => {
    const response = await updateNameFrom(origin);
    expect(response.status).toBe(200);
  });
});

describe("createAuth client IP", () => {
  it("records the cf-connecting-ip address, not a client-set x-forwarded-for", async () => {
    const baseURL = "http://localhost";
    const auth = authFor({ BETTER_AUTH_URL: baseURL });
    const email = nextEmail();
    await auth.api.signUpEmail({ body: { name: "Server Test", email, password: PASSWORD } });
    const response = await auth.handler(
      post(baseURL, "/sign-in/email", { email, password: PASSWORD }, {
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.9",
      })
    );
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    const row = await app.db
      .prepare("SELECT ip_address AS ipAddress FROM session WHERE token = ?")
      .bind(token)
      .first<{ ipAddress: string | null }>();
    expect(row?.ipAddress).toBe("203.0.113.7");
  });
});

describe("createAuth rate limit", () => {
  const OLD_SIGN_IN_RULE_MAX = 3;

  it("switches Better Auth's own per-isolate limiter off, so only the shared limiter at the route counts", async () => {
    const baseURL = "http://localhost";
    const auth = authFor({ BETTER_AUTH_URL: baseURL });
    expect(auth.options.rateLimit).toEqual({ enabled: false });
    expect((await auth.$context).rateLimit.enabled).toBe(false);

    const email = nextEmail();
    await auth.api.signUpEmail({ body: { name: "Server Test", email, password: PASSWORD } });
    const statuses: number[] = [];
    for (let attempt = 0; attempt <= OLD_SIGN_IN_RULE_MAX; attempt++) {
      const response = await auth.handler(
        post(baseURL, "/sign-in/email", { email, password: PASSWORD }, { "cf-connecting-ip": "203.0.113.70" })
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual(Array(OLD_SIGN_IN_RULE_MAX + 1).fill(200));
  });
});
