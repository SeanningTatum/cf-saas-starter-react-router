import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { action as authAction, loader as authLoader } from "@/routes/api/auth.$";
import { action as uploadAction } from "@/routes/api/upload-file";
import { trackedUpload } from "@/routes/api/__tests__/tracked-upload";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import {
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMIT_REQUESTS_PER_PERIOD,
  RATE_LIMITED_CODE,
  RETRY_AFTER_HEADER,
  UPLOAD_RATE_LIMITED_MESSAGE,
  msLeftInRateLimitWindow,
} from "@/lib/constants/rate-limit";
import { BASE_URL, startRealApp, type RealApp } from "./real-d1";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const PASSWORD = "correct-horse-battery-staple";
const WINDOW_MARGIN_MS = 10_000;
const ROLLOVER_SLACK_MS = 250;

let app: RealApp;
let ipCount = 0;
let emailCount = 0;

const nextIp = () => `198.51.100.${++ipCount}`;
const nextEmail = () => `rate-limit-${++emailCount}@limit.test`;

const startEarlyInWindow = async () => {
  const left = msLeftInRateLimitWindow(Date.now());
  if (left < WINDOW_MARGIN_MS) await new Promise((resolve) => setTimeout(resolve, left + ROLLOVER_SLACK_MS));
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

const upload = async (request: Request) =>
  (await uploadAction({ request, context: app.loadContext, params: {} } as unknown as Parameters<
    typeof uploadAction
  >[0])) as unknown as UploadResult;

const uploadAs = async (headers: Headers) =>
  upload((await trackedUpload(`${BASE_URL}/api/upload-file`, { headers })).request);

const statusOf = (result: UploadResult) => result.init?.status ?? 200;

beforeAll(async () => {
  app = await startRealApp();
}, 60_000);

afterAll(async () => {
  await app?.dispose();
});

describe("rate limits on the real limiter binding", { timeout: 60_000 }, () => {
  it("holds sign-in to its limit: answers up to it, refuses the next with 429, and still serves another client IP", async () => {
    const limit = RATE_LIMIT_REQUESTS_PER_PERIOD.signIn;
    const { email } = await app.signUp(nextEmail());
    const signIn = (ip: string) => postAuth("/sign-in/email", ip, { email, password: PASSWORD });
    const ip = nextIp();
    await startEarlyInWindow();

    const underLimit = await statuses(limit, () => signIn(ip));
    const overLimit = await signIn(ip);
    const otherClient = await signIn(nextIp());

    expect(underLimit).toEqual(Array(limit).fill(200));
    await expectOurRefusal(overLimit);
    expect(otherClient.status).toBe(200);
  });

  it("holds sign-up to its own lower limit, apart from sign-in", async () => {
    const limit = RATE_LIMIT_REQUESTS_PER_PERIOD.signUp;
    expect(limit).toBeLessThan(RATE_LIMIT_REQUESTS_PER_PERIOD.signIn);
    const signUp = (ip: string) =>
      postAuth("/sign-up/email", ip, { name: "Limit Test", email: nextEmail(), password: PASSWORD });
    const ip = nextIp();
    await startEarlyInWindow();

    const underLimit = await statuses(limit, () => signUp(ip));
    const overLimit = await signUp(ip);
    const otherClient = await signUp(nextIp());
    const signInSameIp = await postAuth("/sign-in/email", ip, { email: "nobody@limit.test", password: PASSWORD });

    expect(underLimit).toEqual(Array(limit).fill(200));
    await expectOurRefusal(overLimit);
    expect(otherClient.status).toBe(200);
    expect(signInSameIp.status).not.toBe(HTTP_TOO_MANY_REQUESTS);
  });

  it("holds other auth POSTs such as sign-out to the general auth limit, and never limits a session read past it", async () => {
    const limit = RATE_LIMIT_REQUESTS_PER_PERIOD.authApi;
    const signOut = (ip: string) => postAuth("/sign-out", ip, {});
    const ip = nextIp();
    await startEarlyInWindow();

    const underLimit = await statuses(limit, () => signOut(ip));
    const overLimit = await signOut(ip);
    const sessionReads = await statuses(limit + 1, () => getSession(ip));

    expect(underLimit).not.toContain(HTTP_TOO_MANY_REQUESTS);
    await expectOurRefusal(overLimit);
    expect(sessionReads).toEqual(Array(limit + 1).fill(200));
  });

  it("refuses an upload over the per-user limit with 429, Retry-After and the route's own body, without reading the body, and leaves another user alone", async () => {
    const limit = RATE_LIMIT_REQUESTS_PER_PERIOD.upload;
    const uploader = await app.signUp(nextEmail());
    const bystander = await app.signUp(nextEmail());
    await startEarlyInWindow();

    const underLimit: number[] = [];
    for (let i = 0; i < limit; i++) underLimit.push(statusOf(await uploadAs(uploader.headers)));
    const overLimitUpload = await trackedUpload(`${BASE_URL}/api/upload-file`, { headers: uploader.headers });
    const overLimit = await upload(overLimitUpload.request);
    const otherUser = await uploadAs(bystander.headers);

    expect(underLimit).not.toContain(HTTP_TOO_MANY_REQUESTS);
    expect(statusOf(overLimit)).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(new Headers(overLimit.init?.headers).get(RETRY_AFTER_HEADER)).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
    expect(overLimit.data).toEqual({ success: false, error: UPLOAD_RATE_LIMITED_MESSAGE });
    expect(overLimitUpload.bodyRead()).toBe(false);
    expect(statusOf(otherUser)).not.toBe(HTTP_TOO_MANY_REQUESTS);
  });
});
