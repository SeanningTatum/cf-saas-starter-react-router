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

import worker from "../app";
import { securityHeaders } from "../security-headers";

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
    new Request("https://app.example.com/dashboard") as Parameters<typeof worker.fetch>[0],
    env,
    ctx
  );
  await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
  return response;
};

const expectSecurityHeaders = (response: Response) => {
  const expected = securityHeaders();
  for (const name of Object.keys(expected)) {
    expect(response.headers.get(name), name).not.toBeNull();
  }
  expect(response.headers.get("Content-Security-Policy")).toMatch(/script-src [^;]*'nonce-[^']+'/);
  expect(response.headers.get("X-Frame-Options")).toBe(expected["X-Frame-Options"]);
};

beforeEach(() => {
  mocks.handle.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("every response out of the worker carries the security headers", () => {
  it("a page the handler renders", async () => {
    mocks.handle.mockResolvedValue(new Response("ok", { headers: { "X-Frame-Options": "ALLOWALL" } }));
    const response = await serve();
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it("the 500 for a handler that throws, so a crash page cannot be framed or run injected script", async () => {
    mocks.handle.mockRejectedValue(new Error("handler blew up"));
    const response = await serve();
    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
  });

  it("the 500 for a runtime that cannot be built, so a missing binding does not drop the headers", async () => {
    const response = await serve(fakeEnv({ DATABASE: undefined }));
    expect(response.status).toBe(500);
    expect(mocks.handle).not.toHaveBeenCalled();
    expectSecurityHeaders(response);
  });
});
