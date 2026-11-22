import { afterAll, afterEach, beforeEach, describe, expect, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("DEV", false);
});

import { it } from "@effect/vitest";
import { Effect } from "effect";
import { consoleAdapter } from "../console";
import type { ErrorReport } from "../../adapter";

const report = (over: Partial<ErrorReport>): ErrorReport => ({
  id: "r1",
  timestamp: "2026-01-01T00:00:00.000Z",
  source: "loader",
  kind: "defect",
  level: "error",
  name: "Error",
  message: "boom",
  requestId: "req-1",
  release: "v1",
  environment: "test",
  ...over,
});

let lines: Array<Record<string, unknown>> = [];

beforeEach(() => {
  lines = [];
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

describe("consoleAdapter", () => {
  it.effect("writes one line per report at the report's level, so a warning never shows as an error", () =>
    Effect.gen(function* () {
      yield* consoleAdapter.send([
        report({ id: "r1", level: "error", message: "first" }),
        report({ id: "r2", level: "warning", message: "second" }),
      ]);

      expect(lines.map((line) => [line.level, line.msg])).toEqual([
        ["error", "first"],
        ["warn", "second"],
      ]);
    })
  );

  it.effect("puts the report under errorReport, so log search finds it by id, source and request", () =>
    Effect.gen(function* () {
      yield* consoleAdapter.send([report({ id: "r9", source: "trpc" })]);

      expect(lines[0]?.errorReport).toMatchObject({
        id: "r9",
        source: "trpc",
        requestId: "req-1",
        kind: "defect",
      });
    })
  );
});
