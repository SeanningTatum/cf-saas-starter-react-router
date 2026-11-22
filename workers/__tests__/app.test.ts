import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  vi.stubEnv("DEV", false);
  return {
    handle: vi.fn<(request: Request, context: unknown) => Promise<Response>>(),
  };
});

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  createRequestHandler: () => mocks.handle,
}));

vi.mock("@/auth/server", () => ({
  createAuth: () => ({ api: { getSession: () => Promise.resolve(null) } }),
}));

import type { AppLoadContext } from "react-router";
import worker from "../app";

const rayId = () => "8f1a2b3c4d5e6f70-SJC";

const fakeEnv = (over: Partial<Env> = {}): Env =>
  ({
    DATABASE: {} as D1Database,
    BUCKET: {} as R2Bucket,
    BETTER_AUTH_SECRET: "fake-secret-for-tests-0123456789abcdef-not-real",
    BETTER_AUTH_URL: "https://app.example.com",
    ...over,
  }) as Env;

const serve = async (env: Env = fakeEnv()) => {
  const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
  const ctx = { waitUntil, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const response = await worker.fetch(
    new Request("https://app.example.com/dashboard", {
      headers: { "cf-ray": rayId() },
    }) as Parameters<typeof worker.fetch>[0],
    env,
    ctx
  );
  await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
  return { response, waitUntil };
};

let lines: Array<Record<string, unknown>> = [];
const reportLines = () =>
  lines
    .map((line) => line.errorReport)
    .filter((report): report is Record<string, unknown> => report !== undefined);

beforeEach(() => {
  lines = [];
  mocks.handle.mockReset();
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("worker fetch, error capture", () => {
  it("answers 500 naming the request id and reports a fetch error when the handler throws, so a crash is never silent", async () => {
    mocks.handle.mockRejectedValue(new Error("handler blew up"));

    const { response } = await serve();

    expect(mocks.handle).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(rayId());
    expect(await response.text()).toContain(rayId());
    expect(reportLines()).toEqual([
      expect.objectContaining({ source: "fetch", requestId: rayId(), kind: "defect" }),
    ]);
  });

  it("answers 500 and reports a fetch error when the runtime cannot be built, so a missing binding is seen", async () => {
    const { response } = await serve(fakeEnv({ DATABASE: undefined }));

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(rayId());
    expect(mocks.handle).not.toHaveBeenCalled();
    expect(reportLines()).toEqual([
      expect.objectContaining({ source: "fetch", requestId: rayId() }),
    ]);
  });

  it("gives the handler a working reportError, so a loader's error reaches the adapter with the request id", async () => {
    mocks.handle.mockImplementation(async (_request, context) => {
      (context as AppLoadContext).reportError({
        error: new Error("loader failed"),
        source: "loader",
      });
      return new Response("ok");
    });

    const { response } = await serve();

    expect(response.status).toBe(200);
    expect(reportLines()).toEqual([
      expect.objectContaining({ source: "loader", requestId: rayId() }),
    ]);
  });

  it("hands each delivery to ctx.waitUntil, so the worker is not torn down before the report is sent", async () => {
    mocks.handle.mockResolvedValue(new Response("ok"));
    const quiet = await serve();

    mocks.handle.mockImplementation(async (_request, context) => {
      (context as AppLoadContext).reportError({
        error: new Error("loader failed"),
        source: "loader",
      });
      return new Response("ok");
    });
    const reported = await serve();

    expect(reported.waitUntil.mock.calls.length).toBe(
      quiet.waitUntil.mock.calls.length + 1
    );
  });
});
