import { Effect, Layer, ManagedRuntime } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import { makeTestDatabase } from "@/services/database.test-layer";
import { ConfigurationError } from "@/models/errors/repository";

const SECRET_DETAIL = "D1_ERROR: no such table: user_secret_column";

type Run = () => Promise<unknown>;

const freshRoute = async (run: Run, env: Partial<Env> = { RELEASE_VERSION: "v3.1.0" }) => {
  vi.resetModules();
  const route = await import("../healthz");
  const { HealthRepository } = await import("@/repositories/health");
  const runSpy = vi.fn(run);
  const runtime = ManagedRuntime.make(
    HealthRepository.Default.pipe(Layer.provide(makeTestDatabase({ run: runSpy }))),
  );
  const reported: ErrorCapture[] = [];
  const context = {
    runtime,
    cloudflare: { env },
    reportError: (capture: ErrorCapture) => void reported.push(capture),
  };
  const get = () => route.loader({ context });
  return { get, runSpy, reported, route };
};

const up: Run = () => Promise.resolve({ success: true, results: [] });
const down: Run = () => Promise.reject(new Error(SECRET_DETAIL));

describe("/healthz", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 200 with status up and the release version, so that a smoke check can tell a live build from an old one", async () => {
    const { get } = await freshRoute(up);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "up", release: "v3.1.0" });
  });

  it("answers 503 with status down when the database query fails and never echoes the error text, so that a public caller learns nothing about the schema", async () => {
    const { get } = await freshRoute(down);
    const response = await get();
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "down", release: "v3.1.0" });
    expect(body).not.toContain("D1_ERROR");
    expect(body).not.toContain("QueryError");
  });

  it("holds exactly two keys in the body, so that a later change cannot add a latency, user or schema field without failing here", async () => {
    const { get } = await freshRoute(up);
    expect(Object.keys(await (await get()).json()).sort()).toEqual(["release", "status"]);
  });

  it("reports the release as unversioned when RELEASE_VERSION is not set, so that a local or unreleased build still answers", async () => {
    const { get } = await freshRoute(up, {});
    expect(await (await get()).json()).toEqual({ status: "up", release: "unversioned" });
  });

  it("sends cache-control no-store and a JSON content type, so that no cache in front of the Worker serves an old answer to a smoke check", async () => {
    const { get } = await freshRoute(up);
    const response = await get();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("queries the database once for many calls inside the window, so that a flood of public requests cannot turn into a flood of D1 reads", async () => {
    const { get, runSpy } = await freshRoute(up);
    for (let call = 0; call < 5; call += 1) {
      expect((await get()).status).toBe(200);
    }
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("answers 405 with an empty body and allow GET, HEAD to any other method, so that the route only reads and a wrong method shows no stack, in dev or production", async () => {
    const { route, runSpy } = await freshRoute(up);
    const response = await route.action();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(await response.text()).toBe("");
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("answers 503 and hands the cause to reportError when the runtime cannot build the database, so that a missing binding reads as down and is still seen", async () => {
    vi.resetModules();
    const route = await import("../healthz");
    const { HealthRepository } = await import("@/repositories/health");
    const broken = Layer.effect(
      HealthRepository,
      Effect.fail(new ConfigurationError({ service: "Database", field: "DATABASE" })),
    );
    const reported: ErrorCapture[] = [];
    const response = await route.loader({
      context: {
        runtime: ManagedRuntime.make(broken),
        cloudflare: { env: { RELEASE_VERSION: "v3.1.0" } },
        reportError: (capture) => void reported.push(capture),
      },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "down", release: "v3.1.0" });
    expect(reported).toHaveLength(1);
    expect(reported[0]?.source).toBe("loader");
  });
});
