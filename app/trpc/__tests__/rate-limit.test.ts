import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppLoadContext } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { action as authAction, loader as authLoader } from "@/routes/api/auth.$";
import { action as uploadAction } from "@/routes/api/upload-file";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import {
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMIT_BINDINGS,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMITED_CODE,
  RETRY_AFTER_HEADER,
  UPLOAD_RATE_LIMITED_MESSAGE,
  type RateLimitBindingName,
} from "@/lib/constants/rate-limit";
import { BASE_URL, startRealApp, type RealApp } from "./real-d1";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const WRANGLER = fileURLToPath(new URL("../../../wrangler.jsonc", import.meta.url));
const PASSWORD = "correct-horse-battery-staple";
const WINDOW_MS = RATE_LIMIT_PERIOD_SECONDS * 1000;
const MARGIN_MS = 10_000;
const ROLLOVER_SLACK_MS = 250;
const ATTEMPTS = 2;
const JSONC_LINE_COMMENT = /^\s*\/\/.*$/gm;

interface RateLimitEntry {
  readonly name: string;
  readonly simple: { readonly limit: number };
}

const limitOf = (binding: RateLimitBindingName): number => {
  const config = JSON.parse(readFileSync(WRANGLER, "utf8").replace(JSONC_LINE_COMMENT, "")) as {
    ratelimits: ReadonlyArray<RateLimitEntry>;
  };
  const entry = config.ratelimits.find((candidate) => candidate.name === binding);
  if (entry === undefined) return expect.unreachable(`wrangler.jsonc has no ${binding}`);
  return entry.simple.limit;
};

let app: RealApp;
let ipCount = 0;
let emailCount = 0;

const nextIp = () => `198.51.100.${++ipCount}`;
const nextEmail = () => `rate-limit-${++emailCount}@limit.test`;

const windowOf = (ms: number) => Math.floor(ms / WINDOW_MS);

const waitOutWindowEnd = async () => {
  const left = WINDOW_MS - (Date.now() % WINDOW_MS);
  if (left < MARGIN_MS) await new Promise((resolve) => setTimeout(resolve, left + ROLLOVER_SLACK_MS));
};

const inOneWindow = async <T>(run: (ip: string) => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    await waitOutWindowEnd();
    const started = windowOf(Date.now());
    const result = await run(nextIp());
    if (windowOf(Date.now()) === started || attempt >= ATTEMPTS) return result;
  }
};

const postAuth = (path: string, ip: string, body: unknown) =>
  authAction({
    request: new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [CLIENT_IP_HEADER]: ip },
      body: JSON.stringify(body),
    }),
    context: app.loadContext,
    params: {},
  } as unknown as Parameters<typeof authAction>[0]);

const getSession = (ip: string) =>
  authLoader({
    request: new Request(`${BASE_URL}/api/auth/get-session`, { headers: { [CLIENT_IP_HEADER]: ip } }),
    context: app.loadContext,
    params: {},
  } as unknown as Parameters<typeof authLoader>[0]);

const statuses = async (count: number, send: () => Promise<Response>) => {
  const seen: number[] = [];
  for (let i = 0; i < count; i++) seen.push((await send()).status);
  return seen;
};

const expectOurRefusal = async (response: Response) => {
  expect(response.status).toBe(HTTP_TOO_MANY_REQUESTS);
  expect(response.headers.get(RETRY_AFTER_HEADER)).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
  expect(await response.json()).toMatchObject({ code: RATE_LIMITED_CODE });
};

type UploadResult = { data: { success: boolean; error?: string }; init: ResponseInit | null };

const upload = async (headers: Headers, context: AppLoadContext = app.loadContext) =>
  (await uploadAction({
    request: new Request(`${BASE_URL}/api/upload-file`, { method: "POST", headers, body: new FormData() }),
    context,
    params: {},
  } as unknown as Parameters<typeof uploadAction>[0])) as unknown as UploadResult;

const statusOf = (result: UploadResult) => result.init?.status ?? 200;

beforeAll(async () => {
  app = await startRealApp();
}, 60_000);

afterAll(async () => {
  await app?.dispose();
});

describe("rate limits on the real limiter binding", { timeout: 60_000 }, () => {
  it("answers sign-in up to the limit, refuses the next with 429, and still serves another client IP", async () => {
    const limit = limitOf(RATE_LIMIT_BINDINGS.signIn);
    const { email } = await app.signUp(nextEmail());
    const signIn = (ip: string) => postAuth("/sign-in/email", ip, { email, password: PASSWORD });

    const { underLimit, overLimit, otherClient } = await inOneWindow(async (ip) => ({
      underLimit: await statuses(limit, () => signIn(ip)),
      overLimit: await signIn(ip),
      otherClient: await signIn(nextIp()),
    }));

    expect(underLimit).toEqual(Array(limit).fill(200));
    await expectOurRefusal(overLimit);
    expect(otherClient.status).toBe(200);
  });

  it("holds sign-up to its own lower limit, apart from sign-in", async () => {
    const limit = limitOf(RATE_LIMIT_BINDINGS.signUp);
    expect(limit).toBeLessThan(limitOf(RATE_LIMIT_BINDINGS.signIn));
    const signUp = (ip: string) =>
      postAuth("/sign-up/email", ip, { name: "Limit Test", email: nextEmail(), password: PASSWORD });

    const { underLimit, overLimit, otherClient, signInSameIp } = await inOneWindow(async (ip) => ({
      underLimit: await statuses(limit, () => signUp(ip)),
      overLimit: await signUp(ip),
      otherClient: await signUp(nextIp()),
      signInSameIp: await postAuth("/sign-in/email", ip, { email: "nobody@limit.test", password: PASSWORD }),
    }));

    expect(underLimit).toEqual(Array(limit).fill(200));
    await expectOurRefusal(overLimit);
    expect(otherClient.status).toBe(200);
    expect(signInSameIp.status).not.toBe(HTTP_TOO_MANY_REQUESTS);
  });

  it("never limits a session read, even once the same client is over the general auth limit", async () => {
    const limit = limitOf(RATE_LIMIT_BINDINGS.authApi);
    const signOut = (ip: string) => postAuth("/sign-out", ip, {});

    const { underLimit, overLimit, sessionReads } = await inOneWindow(async (ip) => ({
      underLimit: await statuses(limit, () => signOut(ip)),
      overLimit: await signOut(ip),
      sessionReads: await statuses(limit + 1, () => getSession(ip)),
    }));

    expect(underLimit).not.toContain(HTTP_TOO_MANY_REQUESTS);
    await expectOurRefusal(overLimit);
    expect(sessionReads).toEqual(Array(limit + 1).fill(200));
  });

  it("refuses an upload over the per-user limit with 429, Retry-After and the route's own body, and leaves another user alone", async () => {
    const limit = limitOf(RATE_LIMIT_BINDINGS.upload);
    const uploader = await app.signUp(nextEmail());
    const bystander = await app.signUp(nextEmail());

    const { underLimit, overLimit, otherUser } = await inOneWindow(async () => {
      const results: UploadResult[] = [];
      for (let i = 0; i < limit; i++) results.push(await upload(uploader.headers));
      return {
        underLimit: results.map(statusOf),
        overLimit: await upload(uploader.headers),
        otherUser: await upload(bystander.headers),
      };
    });

    expect(underLimit).not.toContain(HTTP_TOO_MANY_REQUESTS);
    expect(statusOf(overLimit)).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(new Headers(overLimit.init?.headers).get(RETRY_AFTER_HEADER)).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
    expect(overLimit.data).toEqual({ success: false, error: UPLOAD_RATE_LIMITED_MESSAGE });
    expect(statusOf(otherUser)).not.toBe(HTTP_TOO_MANY_REQUESTS);
  });
});
