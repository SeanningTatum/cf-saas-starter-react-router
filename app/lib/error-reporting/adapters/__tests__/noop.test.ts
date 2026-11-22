import { afterEach, describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { noopAdapter } from "../noop";
import type { ErrorReport } from "../../adapter";

const report = (): ErrorReport => ({
  id: "r1",
  timestamp: "2026-01-01T00:00:00.000Z",
  source: "fetch",
  kind: "defect",
  level: "error",
  name: "Error",
  message: "boom",
  release: "v1",
  environment: "test",
});

describe("noopAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.effect("sends and logs nothing and succeeds, so ERROR_REPORTER=none is truly silent", () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn();
      vi.stubGlobal("fetch", fetchFn);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      const exit = yield* Effect.exit(noopAdapter.send([report()]));

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    })
  );
});
