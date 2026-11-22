import { afterEach, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Layer, ManagedRuntime } from "effect";
import type { AppLoadContext } from "react-router";
import { action, loader } from "../auth.$";
import { RateLimiter, type RateLimitRule } from "@/services/rate-limit";
import { RateLimitError } from "@/models/errors/rate-limit";
import { loggers } from "@/lib/logger";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import {
  AUTH_GATE_FAULT_MESSAGE,
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMITED_CODE,
  RETRY_AFTER_HEADER,
} from "@/lib/constants/rate-limit";

type ActionArgs = Parameters<typeof action>[0];
type LoaderArgs = Parameters<typeof loader>[0];

const HANDLED = "handled by Better Auth";
const ORIGIN = "http://localhost";

const runtimes: Array<ManagedRuntime.ManagedRuntime<never, never>> = [];

const contextWith = (layer: Layer.Layer<RateLimiter> | Layer.Layer<never>) => {
  const runtime = ManagedRuntime.make(layer);
  runtimes.push(runtime as ManagedRuntime.ManagedRuntime<never, never>);
  const handler = vi.fn(async (_request: Request) => new Response(HANDLED));
  const reportError = vi.fn();
  const context = { runtime, auth: { handler }, reportError } as unknown as AppLoadContext;
  return { context, handler, reportError };
};

const limiterLayer = (allow: boolean, seen: Array<[RateLimitRule, string]> = []) =>
  Layer.succeed(RateLimiter, {
    check: (rule, key) => {
      seen.push([rule, key]);
      return allow
        ? Effect.void
        : Effect.fail(new RateLimitError({ rule, retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS }));
    },
  });

const post = (path: string) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { [CLIENT_IP_HEADER]: "203.0.113.20", "content-type": "application/json" },
    body: "{}",
  });

const callAction = (request: Request, context: AppLoadContext) =>
  action({ request, context, params: {} } as unknown as ActionArgs);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe("/api/auth/* action", () => {
  it("hands a request under the limit to Better Auth, after checking its rule and client key", async () => {
    const seen: Array<[RateLimitRule, string]> = [];
    const { context, handler, reportError } = contextWith(limiterLayer(true, seen));
    const request = post("/api/auth/sign-in/email");

    const response = await callAction(request, context);

    expect(await response.text()).toBe(HANDLED);
    expect(handler).toHaveBeenCalledWith(request);
    expect(seen).toEqual([["signIn", "203.0.113.20"]]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After and never reaches Better Auth once over the limit", async () => {
    const { context, handler } = contextWith(limiterLayer(false));

    const response = await callAction(post("/api/auth/sign-up/email"), context);

    expect(response.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(response.headers.get(RETRY_AFTER_HEADER)).toBe(String(RATE_LIMIT_PERIOD_SECONDS));
    expect(await response.json()).toMatchObject({ code: RATE_LIMITED_CODE });
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets the request through to Better Auth, logs, and reports the fault as an action error, when the gate itself breaks", async () => {
    const logged = vi.spyOn(loggers.auth, "error").mockImplementation(() => {});
    const { context, handler, reportError } = contextWith(Layer.empty);

    const response = await callAction(post("/api/auth/sign-in/email"), context);

    expect(await response.text()).toBe(HANDLED);
    expect(handler).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith(expect.anything(), AUTH_GATE_FAULT_MESSAGE);
    expect(reportError).toHaveBeenCalledOnce();
    const [capture] = reportError.mock.calls[0] ?? [];
    expect(capture.source).toBe("action");
    expect(Cause.isCause(capture.error)).toBe(true);
  });

  it("reports nothing when it answers 429, since a limited caller is expected", async () => {
    const { context, reportError } = contextWith(limiterLayer(false));

    const response = await callAction(post("/api/auth/sign-in/email"), context);

    expect(response.status).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("/api/auth/* loader", () => {
  it("serves a GET straight from Better Auth, without asking the limiter", async () => {
    const seen: Array<[RateLimitRule, string]> = [];
    const { context, handler } = contextWith(limiterLayer(false, seen));
    const request = new Request(`${ORIGIN}/api/auth/get-session`);

    const response = await loader({ request, context, params: {} } as unknown as LoaderArgs);

    expect(await response.text()).toBe(HANDLED);
    expect(handler).toHaveBeenCalledWith(request);
    expect(seen).toEqual([]);
  });
});
