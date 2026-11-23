import { afterEach, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Layer, ManagedRuntime } from "effect";
import type { AppLoadContext } from "react-router";
import { action, loader } from "../auth.$";
import { RateLimiter, type RateLimitRule } from "@/services/rate-limit";
import { RateLimitError } from "@/models/errors/rate-limit";
import { loggers } from "@/lib/logger";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import { ROUTE_ERROR_RESPONSE_NAME } from "@/lib/constants/error-reporting";
import type { ErrorReport, ErrorReporterAdapter } from "@/lib/error-reporting/adapter";
import { makeRequestContext } from "@/lib/request-context";
import { makeErrorReporter, reportError as deliverReport } from "@/services/error-reporter";
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

const SECRET_PASSWORD = "hunter2-correct-horse";
const SECRET_EMAIL = "person@example.com";
const SECRET_COOKIE = "session_token=cookie-value-abc123";
const SECRET_AUTHORIZATION = "Bearer authorization-value-xyz789";
const SECRET_QUERY = "callback-token-q1w2e3";
const SECRET_RESPONSE_BODY = "response-body-detail-r4t5y6";
const SECRET_SET_COOKIE = "set-cookie-value-u7i8o9";
const SECRETS = [
  SECRET_PASSWORD,
  SECRET_EMAIL,
  SECRET_COOKIE,
  SECRET_AUTHORIZATION,
  SECRET_QUERY,
  SECRET_RESPONSE_BODY,
  SECRET_SET_COOKIE,
];
const SIGN_IN_PATH = "/api/auth/sign-in/email";

const credentialedRequest = (method: "GET" | "POST") =>
  new Request(`${ORIGIN}${SIGN_IN_PATH}?token=${SECRET_QUERY}`, {
    method,
    headers: {
      [CLIENT_IP_HEADER]: "203.0.113.20",
      "content-type": "application/json",
      cookie: SECRET_COOKIE,
      authorization: SECRET_AUTHORIZATION,
    },
    ...(method === "POST"
      ? { body: JSON.stringify({ email: SECRET_EMAIL, password: SECRET_PASSWORD }) }
      : {}),
  });

const reportingContext = (request: Request, status: number) => {
  const reports: ErrorReport[] = [];
  const deliveries: Array<Promise<void>> = [];
  const adapter: ErrorReporterAdapter = {
    name: "recording",
    send: (batch) => Effect.sync(() => void reports.push(...batch)),
  };
  const requestContext = makeRequestContext(request);
  const reporter = makeErrorReporter({
    adapter,
    release: "v0.0.0-test",
    environment: "test",
    request: requestContext,
    waitUntil: (delivery) => void deliveries.push(delivery),
  });
  const runtime = ManagedRuntime.make(limiterLayer(true));
  runtimes.push(runtime as ManagedRuntime.ManagedRuntime<never, never>);
  const answer = new Response(SECRET_RESPONSE_BODY, {
    status,
    headers: { "set-cookie": SECRET_SET_COOKIE },
  });
  const handler = vi.fn(async (_request: Request) => answer);
  const reportError = vi.fn((capture: Parameters<AppLoadContext["reportError"]>[0]) =>
    deliverReport(reporter, capture),
  );
  const context = {
    runtime,
    auth: { handler },
    reportError,
    requestId: requestContext.requestId,
  } as unknown as AppLoadContext;
  return {
    context,
    answer,
    reportError,
    requestId: requestContext.requestId,
    reports: async () => {
      await Promise.all(deliveries);
      return reports;
    },
  };
};

describe("/api/auth/* server errors that Better Auth returns as a response", () => {
  it.each([500, 503])(
    "reports a returned %i once, as a defect, with only the status, the path without its query, and the request id",
    async (status) => {
      const request = credentialedRequest("POST");
      const { context, answer, reportError, requestId, reports } = reportingContext(
        request,
        status,
      );

      const response = await callAction(request, context);

      expect(response).toBe(answer);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(SECRET_RESPONSE_BODY);
      expect(reportError).toHaveBeenCalledOnce();
      expect(reportError).toHaveBeenCalledWith({
        error: { status, statusText: "" },
        source: "action",
        requestId,
      });
      const sent = await reports();
      expect(sent).toHaveLength(1);
      const [report] = sent;
      expect(report).toEqual({
        id: expect.any(String),
        timestamp: expect.any(String),
        source: "action",
        kind: "defect",
        level: "error",
        name: ROUTE_ERROR_RESPONSE_NAME,
        message: String(status),
        tag: String(status),
        requestId,
        release: "v0.0.0-test",
        environment: "test",
        method: "POST",
        path: SIGN_IN_PATH,
      });
    },
  );

  it("reports a returned 500 from the loader as a loader defect", async () => {
    const request = credentialedRequest("GET");
    const { context, answer, reportError, requestId } = reportingContext(request, 500);

    const response = await loader({ request, context, params: {} } as unknown as LoaderArgs);

    expect(response).toBe(answer);
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith({
      error: { status: 500, statusText: "" },
      source: "loader",
      requestId,
    });
  });

  it.each([401, 403, 429])(
    "does not report a returned %i, since a refused sign-in is expected",
    async (status) => {
      const request = credentialedRequest("POST");
      const { context, answer, reportError, reports } = reportingContext(request, status);

      const response = await callAction(request, context);

      expect(response).toBe(answer);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(SECRET_RESPONSE_BODY);
      expect(reportError).not.toHaveBeenCalled();
      expect(await reports()).toEqual([]);
    },
  );

  it.each(["GET", "POST"] as const)(
    "never carries a body, a cookie, an authorization value, an email or a query string into a %s report",
    async (method) => {
      const request = credentialedRequest(method);
      const { context, reportError, reports } = reportingContext(request, 500);

      await (method === "GET"
        ? loader({ request, context, params: {} } as unknown as LoaderArgs)
        : callAction(request, context));

      const captured = JSON.stringify(reportError.mock.calls);
      const sent = JSON.stringify(await reports());
      expect(sent).not.toBe("[]");
      for (const secret of SECRETS) {
        expect(captured).not.toContain(secret);
        expect(sent).not.toContain(secret);
      }
    },
  );
});
