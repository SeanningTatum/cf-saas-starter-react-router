import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("DEV", false);
});

import { Layer, ManagedRuntime } from "effect";
import { TRPCError } from "@trpc/server";
import type { AppLoadContext } from "react-router";
import { action, loader } from "../trpc.$";
import { AuthApi, type AuthApiShape } from "@/services/auth";
import type { AppRuntime } from "@/runtime";

const adminSession = () => ({
  session: { id: "s1", userId: "u1", expiresAt: new Date(0), token: "t" },
  user: { id: "u1", role: "admin", email: "user@example.com", name: "Admin" },
});

const contextWith = (reportError: AppLoadContext["reportError"]) => {
  const api = { getSession: () => Promise.resolve(adminSession()) };
  const runtime = ManagedRuntime.make(
    Layer.succeed(AuthApi, { auth: {}, api } as unknown as AuthApiShape)
  );
  return {
    runtime,
    context: { runtime: runtime as unknown as AppRuntime, reportError } as AppLoadContext,
  };
};

type RouteArgs = Parameters<typeof action>[0];

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const failingQuery = () =>
  new Request("https://app.example.com/api/trpc/analytics.getUserStats");

describe("tRPC route", () => {
  it("hands a failed procedure's TRPCError to reportError with source trpc, so a 500 from the API is reported", async () => {
    const reportError = vi.fn();
    const { runtime, context } = contextWith(reportError);

    const response = await loader({
      request: failingQuery(),
      context,
      params: {},
    } as unknown as RouteArgs);
    await runtime.dispose();

    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [capture] = reportError.mock.calls[0] ?? [];
    expect(capture).toMatchObject({ source: "trpc" });
    expect(capture.error).toBeInstanceOf(TRPCError);
    expect(capture.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("reports a failed POST through the action too, so mutations are not a blind spot", async () => {
    const reportError = vi.fn();
    const { runtime, context } = contextWith(reportError);

    await action({
      request: new Request(failingQuery().url, { method: "POST" }),
      context,
      params: {},
    } as unknown as RouteArgs);
    await runtime.dispose();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]?.[0]).toMatchObject({ source: "trpc" });
    expect(reportError.mock.calls[0]?.[0]?.error).toBeInstanceOf(TRPCError);
  });

  it("writes no stack to a log line, so a crash's internals reach the reporter and not the plain log", async () => {
    const reportError = vi.fn();
    const { runtime, context } = contextWith(reportError);

    await loader({
      request: failingQuery(),
      context,
      params: {},
    } as unknown as RouteArgs);
    await runtime.dispose();

    const reported: TRPCError | undefined = reportError.mock.calls[0]?.[0]?.error;
    const causeStack = reported?.cause?.stack ?? "";
    expect(causeStack).not.toBe("");
    for (const line of lines) {
      expect(line).not.toContain("    at ");
      expect(line).not.toContain(causeStack);
    }
  });
});
