import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("DEV", false);
});

import { Either, Option, Schema } from "effect";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  createTRPCRouter,
  devDelayMs,
  publicProcedure,
  stripStackOutsideDev,
  type Context,
} from "..";

/**
 * These cover the two symptoms of one bug: tRPC derives `isDev` from
 * `process.env.NODE_ENV`, which does not exist on Workers, so it resolved to
 * `true` in production — leaking stacks in error payloads and sleeping
 * 100-499ms on every procedure call.
 *
 * Both helpers take `dev` as an argument rather than reading the module-level
 * `isDev`, because `import.meta.env.DEV` is always `true` under vitest and the
 * production branch would otherwise be unreachable (same pattern as
 * `isLevelEnabled` in `lib/log-format.ts`).
 */

describe("stripStackOutsideDev", () => {
  const shape = () => ({
    message: "UNAUTHORIZED",
    code: -32001,
    data: {
      code: "UNAUTHORIZED",
      httpStatus: 401,
      path: "user.getUsers",
      stack: "TRPCError: UNAUTHORIZED\n    at worker-entry.js:77596:11",
    },
  });

  it("drops stack outside dev", () => {
    const result = stripStackOutsideDev(shape(), false);

    expect(result.data).not.toHaveProperty("stack");
  });

  it("keeps everything else outside dev", () => {
    const result = stripStackOutsideDev(shape(), false);

    expect(result.message).toBe("UNAUTHORIZED");
    expect(result.code).toBe(-32001);
    expect(result.data.code).toBe("UNAUTHORIZED");
    expect(result.data.httpStatus).toBe(401);
    expect(result.data.path).toBe("user.getUsers");
  });

  it("keeps stack in dev", () => {
    const result = stripStackOutsideDev(shape(), true);

    expect(result.data.stack).toContain("TRPCError: UNAUTHORIZED");
  });

  it("does not mutate the shape it was given", () => {
    const original = shape();
    stripStackOutsideDev(original, false);

    expect(original.data.stack).toContain("TRPCError: UNAUTHORIZED");
  });

  it("preserves every data key except stack", () => {
    // The `as S` cast in `stripStackOutsideDev` means TypeScript cannot verify
    // that required `data` fields survive the spread — this test is that
    // guarantee, so an edit that drops an extra key fails here rather than
    // compiling silently.
    const kept = {
      code: "BAD_REQUEST",
      httpStatus: 400,
      path: "user.create",
      schemaError: null,
      customField: { nested: true },
    };

    const result = stripStackOutsideDev(
      { message: "m", data: { ...kept, stack: "trace" } },
      false
    );

    expect(Object.keys(result.data).sort()).toEqual(Object.keys(kept).sort());
    expect(result.data).toEqual(kept);
  });

  it("preserves the schemaError the errorFormatter attaches", () => {
    const withSchemaError = {
      message: "BAD_REQUEST",
      data: {
        code: "BAD_REQUEST",
        stack: "trace",
        schemaError: [{ path: ["email"], message: "Invalid email" }],
      },
    };

    const result = stripStackOutsideDev(withSchemaError, false);

    expect(result.data).not.toHaveProperty("stack");
    expect(result.data.schemaError).toEqual([
      { path: ["email"], message: "Invalid email" },
    ]);
  });

  it("is a no-op when there is no stack to strip", () => {
    const noStack = { message: "NOT_FOUND", data: { code: "NOT_FOUND" } };

    expect(stripStackOutsideDev(noStack, false)).toEqual(noStack);
  });

  it("tolerates a shape with no data at all", () => {
    expect(stripStackOutsideDev({ message: "boom" }, false)).toEqual({
      message: "boom",
    });
  });
});

describe("errorFormatter schemaError", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const parseError = () =>
    Either.getLeft(Schema.decodeUnknownEither(Schema.Number)("not a number"));

  const schemaErrorFor = async (code: "BAD_REQUEST" | "INTERNAL_SERVER_ERROR") => {
    const router = createTRPCRouter({
      fails: publicProcedure.query(() =>
        Promise.reject(new TRPCError({ code, cause: Option.getOrUndefined(parseError()) }))
      ),
    });
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      router,
      req: new Request("https://app.example.com/api/trpc/fails"),
      createContext: () =>
        ({ headers: new Headers(), auth: null } as unknown as Context),
    });
    const body: { error: { json: { data: { schemaError: unknown } } } } =
      await response.json();
    return body.error.json.data.schemaError;
  };

  it("shows the decode issues on a BAD_REQUEST, so a form can point at the bad field", async () => {
    expect(await schemaErrorFor("BAD_REQUEST")).toEqual([
      expect.objectContaining({ path: [] }),
    ]);
  });

  it("is null on a 500 caused by a ParseError, so internal decode details never reach the client", async () => {
    expect(await schemaErrorFor("INTERNAL_SERVER_ERROR")).toBeNull();
  });
});

describe("devDelayMs", () => {
  it("is zero outside dev", () => {
    // The production bug: any non-zero value here is latency real users pay.
    expect(devDelayMs(false)).toBe(0);
    expect(devDelayMs(false, 0)).toBe(0);
    expect(devDelayMs(false, 0.999)).toBe(0);
  });

  it("stays within 100-499ms in dev", () => {
    // Upper bound is 499, not 500: Math.random() is exclusive of 1.
    expect(devDelayMs(true, 0)).toBe(100);
    expect(devDelayMs(true, 0.5)).toBe(300);
    expect(devDelayMs(true, 0.9999)).toBe(499);
  });

  it("defaults to a random draw inside the dev range", () => {
    for (let i = 0; i < 50; i++) {
      const ms = devDelayMs(true);
      expect(ms).toBeGreaterThanOrEqual(100);
      expect(ms).toBeLessThanOrEqual(499);
    }
  });
});
