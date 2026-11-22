import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { AppLoadContext } from "react-router";
import { action } from "../upload-file";
import { RateLimiter, type RateLimitRule } from "@/services/rate-limit";
import { RateLimitError } from "@/models/errors/rate-limit";
import {
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMIT_PERIOD_SECONDS,
  RETRY_AFTER_HEADER,
  UPLOAD_RATE_LIMITED_MESSAGE,
} from "@/lib/constants/rate-limit";

type UploadResult = { data: { success: boolean; error?: string }; init: ResponseInit | null };

const USER_ID = "user-upload-test";
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;

const runtimes: Array<ManagedRuntime.ManagedRuntime<RateLimiter, never>> = [];

const contextFor = (signedIn: boolean, allow: boolean) => {
  const seen: Array<[RateLimitRule, string]> = [];
  const runtime = ManagedRuntime.make(
    Layer.succeed(RateLimiter, {
      check: (rule, key) => {
        seen.push([rule, key]);
        return allow
          ? Effect.void
          : Effect.fail(new RateLimitError({ rule, retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS }));
      },
    })
  );
  runtimes.push(runtime);
  const session = signedIn ? { user: { id: USER_ID, banned: false, banExpires: null } } : null;
  const context = {
    runtime,
    auth: { api: { getSession: vi.fn(async () => session) } },
  } as unknown as AppLoadContext;
  return { context, seen };
};

const upload = async (context: AppLoadContext) =>
  (await action({
    request: new Request("http://localhost/api/upload-file", { method: "POST", body: new FormData() }),
    context,
    params: {},
  } as unknown as Parameters<typeof action>[0])) as unknown as UploadResult;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe("upload-file action rate limit", () => {
  it("checks the upload rule against the signed-in user's id", async () => {
    const { context, seen } = contextFor(true, true);

    const result = await upload(context);

    expect(seen).toEqual([["upload", USER_ID]]);
    expect(result.init?.status).toBe(BAD_REQUEST);
  });

  it("answers 429 with Retry-After and the route's own body shape once the user is over the limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { context } = contextFor(true, false);

    const result = await upload(context);

    expect(result.init?.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(new Headers(result.init?.headers).get(RETRY_AFTER_HEADER)).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
    expect(result.data).toEqual({ success: false, error: UPLOAD_RATE_LIMITED_MESSAGE });
  });

  it("answers a signed-out caller 401 without counting against any user", async () => {
    const { context, seen } = contextFor(false, false);

    const result = await upload(context);

    expect(result.init?.status).toBe(UNAUTHORIZED);
    expect(seen).toEqual([]);
  });
});
