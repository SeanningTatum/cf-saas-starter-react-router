import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TurnstileKeys } from "../config";
import { createAuth } from "../server";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import {
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY,
  TURNSTILE_TEST_TOKEN,
  TURNSTILE_TOKEN_HEADER,
} from "@/lib/constants/turnstile";
import { BASE_URL, startRealApp, type RealApp } from "@/trpc/__tests__/real-d1";

const PASSWORD = "correct-horse-battery-staple";
const SERVICE_UNAVAILABLE = 503;
const CLIENT_IP = "192.0.2.44";
const TEST_KEYS: TurnstileKeys = {
  siteKey: TURNSTILE_TEST_SITE_KEY,
  secretKey: TURNSTILE_TEST_SECRET_KEY,
};

type Siteverify = "pass" | "fail" | "unreachable" | "unavailable";

interface SiteverifyCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

let app: RealApp;
let emailCount = 0;
const nextEmail = () => `turnstile-${++emailCount}@turnstile.test`;

const realFetch = globalThis.fetch;

const stubSiteverify = (answer: Siteverify): SiteverifyCall[] => {
  const calls: SiteverifyCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(TURNSTILE_SITEVERIFY_URL)) return realFetch(input, init);
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      if (answer === "unreachable") throw new TypeError("network down");
      if (answer === "unavailable") return new Response("down", { status: SERVICE_UNAVAILABLE });
      return Response.json(
        answer === "pass"
          ? { success: true }
          : { success: false, "error-codes": ["invalid-input-response"] },
      );
    }),
  );
  return calls;
};

const turnstileOn = () => createAuth(app.db, { ...app.authConfig, turnstile: TEST_KEYS });
const turnstileOff = () => createAuth(app.db, { ...app.authConfig, turnstile: null });

const post = (path: string, body: unknown, token?: string) =>
  new Request(`${BASE_URL}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [CLIENT_IP_HEADER]: CLIENT_IP,
      ...(token === undefined ? {} : { [TURNSTILE_TOKEN_HEADER]: token }),
    },
    body: JSON.stringify(body),
  });

const sessionCount = async (userId: string) =>
  (
    await app.db
      .prepare("SELECT count(*) AS n FROM session WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>()
  )?.n;

const userCount = async (email: string) =>
  (
    await app.db
      .prepare("SELECT count(*) AS n FROM user WHERE email = ?")
      .bind(email)
      .first<{ n: number }>()
  )?.n;

const existingUser = async () => {
  const email = nextEmail();
  const { user } = await app.auth.api.signUpEmail({
    body: { name: "Turnstile Test", email, password: PASSWORD },
  });
  return { email, userId: user.id, sessionsBefore: await sessionCount(user.id) };
};

const signIn = (auth: ReturnType<typeof createAuth>, email: string, token?: string) =>
  auth.handler(post("/sign-in/email", { email, password: PASSWORD }, token));

const signUp = (auth: ReturnType<typeof createAuth>, email: string, token?: string) =>
  auth.handler(
    post("/sign-up/email", { name: "Turnstile Test", email, password: PASSWORD }, token),
  );

beforeAll(async () => {
  app = await startRealApp();
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app?.dispose();
});

describe("Turnstile on sign-in and sign-up", { timeout: 60_000 }, () => {
  it("refuses a sign-in with no token and makes no session, without calling Cloudflare", async () => {
    const calls = stubSiteverify("pass");
    const { email, userId, sessionsBefore } = await existingUser();

    const response = await signIn(turnstileOn(), email);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MISSING_RESPONSE" });
    expect(await sessionCount(userId)).toBe(sessionsBefore);
    expect(calls).toEqual([]);
  });

  it("refuses a sign-up with no token and makes no user", async () => {
    stubSiteverify("pass");
    const email = nextEmail();

    const response = await signUp(turnstileOn(), email);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MISSING_RESPONSE" });
    expect(await userCount(email)).toBe(0);
  });

  it("sends the secret, the token and the client IP to Cloudflare's siteverify, and signs in when it passes", async () => {
    const calls = stubSiteverify("pass");
    const { email, userId, sessionsBefore } = await existingUser();

    const response = await signIn(turnstileOn(), email, TURNSTILE_TEST_TOKEN);

    expect(response.status).toBe(200);
    expect(await sessionCount(userId)).toBe((sessionsBefore ?? 0) + 1);
    expect(calls).toEqual([
      {
        url: TURNSTILE_SITEVERIFY_URL,
        body: {
          secret: TURNSTILE_TEST_SECRET_KEY,
          response: TURNSTILE_TEST_TOKEN,
          remoteip: CLIENT_IP,
        },
      },
    ]);
  });

  it("makes the user on a sign-up whose token passes", async () => {
    stubSiteverify("pass");
    const email = nextEmail();

    const response = await signUp(turnstileOn(), email, TURNSTILE_TEST_TOKEN);

    expect(response.status).toBe(200);
    expect(await userCount(email)).toBe(1);
  });

  it("refuses a sign-in whose token Cloudflare rejects, with 403 and no session", async () => {
    stubSiteverify("fail");
    const { email, userId, sessionsBefore } = await existingUser();

    const response = await signIn(turnstileOn(), email, TURNSTILE_TEST_TOKEN);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "VERIFICATION_FAILED" });
    expect(await sessionCount(userId)).toBe(sessionsBefore);
  });

  it("refuses a sign-up whose token Cloudflare rejects, and makes no user", async () => {
    stubSiteverify("fail");
    const email = nextEmail();

    const response = await signUp(turnstileOn(), email, TURNSTILE_TEST_TOKEN);

    expect(response.status).toBe(403);
    expect(await userCount(email)).toBe(0);
  });

  it.each<Siteverify>(["unreachable", "unavailable"])(
    "refuses the sign-in when siteverify is %s, so an outage does not open the door",
    async (outage) => {
      stubSiteverify(outage);
      const { email, userId, sessionsBefore } = await existingUser();

      const response = await signIn(turnstileOn(), email, TURNSTILE_TEST_TOKEN);

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "UNKNOWN_ERROR" });
      expect(await sessionCount(userId)).toBe(sessionsBefore);
    },
  );

  it("leaves other auth endpoints alone, so signing out needs no token", async () => {
    const calls = stubSiteverify("fail");

    const response = await turnstileOn().handler(post("/sign-out", {}));

    expect(response.status).not.toBe(400);
    expect(response.status).not.toBe(403);
    expect(calls).toEqual([]);
  });

  it("asks for no token when Turnstile is off", async () => {
    const calls = stubSiteverify("fail");
    const { email } = await existingUser();

    const response = await signIn(turnstileOff(), email);

    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
  });
});
