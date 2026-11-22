import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("DEV", false);
});

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Effect, Layer, ManagedRuntime } from "effect";
import { runProcedure } from "@/lib/effect-trpc";
import type { AppError } from "@/models/errors/app-error";
import type { AppServices } from "@/runtime";
import { createTRPCRouter, publicProcedure } from "@/trpc";
import { appRouter } from "@/trpc/router";

const SECRET = "secret-internal-detail-db-password";

const runtime = ManagedRuntime.make(Layer.empty) as unknown as ManagedRuntime.ManagedRuntime<
  AppServices,
  AppError
>;

const router = createTRPCRouter({
  failure: publicProcedure.query(() => runProcedure(runtime, Effect.fail(new Error(SECRET)))),
  defect: publicProcedure.query(() => runProcedure(runtime, Effect.die(new Error(SECRET)))),
});

const call = async (path: string) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router,
    req: new Request(`http://localhost/api/trpc/${path}`),
    createContext: () => ({ headers: new Headers(), runtime, auth: null }) as never,
  });
  return { status: response.status, body: await response.text() };
};

afterAll(async () => {
  vi.unstubAllEnvs();
  await runtime.dispose();
});

describe("outside dev, a tRPC 500 tells the client nothing about the failure", () => {
  it.each(["failure", "defect"])(
    "a %s answers 500 with only 'Internal Server Error': no original message, no cause, no stack",
    async (path) => {
      const { status, body } = await call(path);
      expect(status).toBe(500);
      expect(body).toContain("Internal Server Error");
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain("stack");
      expect(body).not.toContain("cause");
    }
  );

  it("builds the router with isDev false from the build flag, so tRPC never falls back to process.env, which a Worker lacks", () => {
    expect(appRouter._def._config.isDev).toBe(false);
  });
});
