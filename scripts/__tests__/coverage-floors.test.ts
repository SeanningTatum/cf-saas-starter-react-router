import { Either } from "effect";
import { assert, describe, expect, it } from "vitest";
import { byFolder, checkFloors, parseSummary, percentOf, shortfallLine, shortfalls, vitestArgs } from "../coverage-floors";
import { COVERAGE_BAR_PERCENT, COVERAGE_FLOORS } from "../lib/coverage-constants";
import type { RunResult, Shell } from "../lib/shell";

const ROOT = "/repo";
const REPORT_DIR = "/tmp/coverage-floors-x";

const summaryOf = (files: Record<string, [number, number]>): string =>
  JSON.stringify({
    total: { lines: { total: 999, covered: 999 } },
    ...Object.fromEntries(Object.entries(files).map(([path, [covered, total]]) => [`${ROOT}/${path}`, { lines: { total, covered } }])),
  });

const fakeShell = (run: RunResult, summary: string | undefined) => {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[][] = [];
  const removed: string[] = [];
  const shell: Shell = {
    cwd: ROOT,
    run: (command, args) => {
      calls.push([command, ...args]);
      return run;
    },
    read: (path) => (path === `${REPORT_DIR}/coverage-summary.json` ? summary : undefined),
    write: () => undefined,
    tempDir: () => REPORT_DIR,
    remove: (path) => {
      removed.push(path);
    },
    out: (text) => {
      out.push(text);
    },
    err: (text) => {
      err.push(text);
    },
  };
  return { shell, out, err, calls, removed };
};

const passed: RunResult = { code: 0, stdout: "", stderr: "" };

describe("the floors themselves", () => {
  it("cover the four folders #95 names, each at or above the 90% bar, so a floor lowered under the bar fails here", () => {
    expect(Object.keys(COVERAGE_FLOORS).sort()).toEqual(["app/lib", "app/repositories", "app/services", "app/trpc"]);
    for (const floor of Object.values(COVERAGE_FLOORS)) expect(floor).toBeGreaterThanOrEqual(COVERAGE_BAR_PERCENT);
  });
});

describe("parseSummary and byFolder", () => {
  it("drops vitest's total row and makes paths relative, so a folder sums only its own files", () => {
    const parsed = parseSummary(summaryOf({ "app/trpc/a.ts": [8, 10], "app/trpc/routes/b.ts": [2, 10], "app/trpcx/c.ts": [0, 50] }), ROOT);
    const folders = byFolder(Either.getOrThrow(parsed), ["app/trpc"]);

    expect(folders).toEqual([
      {
        folder: "app/trpc",
        covered: 10,
        total: 20,
        files: [
          { path: "app/trpc/a.ts", missed: 2 },
          { path: "app/trpc/routes/b.ts", missed: 8 },
        ],
      },
    ]);
    const [trpc] = folders;
    assert(trpc);
    expect(percentOf(trpc)).toBe(50);
  });

  it("refuses text that is not a json-summary instead of reading it as zero coverage", () => {
    expect(Either.isLeft(parseSummary('{"app/a.ts": {"statements": 1}}', ROOT))).toBe(true);
  });
});

describe("shortfalls", () => {
  const folder = (covered: number, total: number) => ({
    folder: "app/lib",
    covered,
    total,
    files: [
      { path: "app/lib/a.ts", missed: 1 },
      { path: "app/lib/b.ts", missed: total - covered - 1 },
      { path: "app/lib/c.ts", missed: 0 },
    ],
  });

  it("passes a folder exactly at its floor and fails one a line under it", () => {
    expect(shortfalls([folder(90, 100)], { "app/lib": 90 })).toEqual([]);
    expect(shortfalls([folder(89, 100)], { "app/lib": 90 })).toHaveLength(1);
  });

  it("says how many lines must run and lists the files with the most lines not run first, skipping files with none", () => {
    const [short] = shortfalls([folder(80, 100)], { "app/lib": 90 });

    expect(short).toMatchObject({ folder: "app/lib", floor: 90, needed: 10, total: 100 });
    expect(short?.worst.map((file) => file.path)).toEqual(["app/lib/b.ts", "app/lib/a.ts"]);
  });

  it("fails a folder with no measured lines, so a renamed folder cannot pass by measuring nothing", () => {
    const [short] = shortfalls([{ folder: "app/gone", covered: 0, total: 0, files: [] }], { "app/gone": 90 });

    assert(short);
    expect(shortfallLine(short)).toMatch(/app\/gone has no measured lines/);
  });

  it("names the folder, the gap rounded up, the lines needed and what to do", () => {
    const [short] = shortfalls([folder(8337, 10000)], { "app/lib": 90 });
    assert(short);
    const line = shortfallLine(short);

    expect(line).toContain("app/lib runs 83.37% of its lines, 6.63 points under its 90% floor");
    expect(line).toContain("663 more of its 10000 lines must run");
    expect(line).toContain("Do this instead:");
    expect(line).toContain("app/lib/b.ts (1662 lines)");
  });
});

describe("checkFloors", () => {
  it("runs only the app and workers tests with v8 coverage limited to the floored folders", () => {
    expect(vitestArgs(REPORT_DIR, ["app/lib"])).toEqual([
      "vitest",
      "run",
      "app",
      "workers",
      "--coverage.enabled",
      "--coverage.reporter=json-summary",
      `--coverage.reportsDirectory=${REPORT_DIR}`,
      "--coverage.include=app/lib/**",
    ]);
  });

  it("exits 0 and prints one ok line per folder when every floor holds, and removes its report folder", () => {
    const { shell, out, err, removed } = fakeShell(passed, summaryOf({ "app/lib/a.ts": [95, 100], "app/trpc/a.ts": [9, 10] }));

    expect(checkFloors(shell, { "app/lib": 90, "app/trpc": 90 })).toBe(0);
    expect(out).toEqual(["ok: app/lib 95.00% of 100 lines (floor 90%)", "ok: app/trpc 90.00% of 10 lines (floor 90%)"]);
    expect(err).toEqual([]);
    expect(removed).toEqual([REPORT_DIR]);
  });

  it("exits 1 and names only the folder that fell", () => {
    const { shell, out, err } = fakeShell(passed, summaryOf({ "app/lib/a.ts": [95, 100], "app/trpc/a.ts": [5, 10] }));

    expect(checkFloors(shell, { "app/lib": 90, "app/trpc": 90 })).toBe(1);
    expect(out).toEqual(["ok: app/lib 95.00% of 100 lines (floor 90%)"]);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^coverage: app\/trpc runs 50\.00%/);
  });

  it("fails on a failing test run rather than judging the coverage of a broken suite", () => {
    const { shell, err } = fakeShell({ code: 1, stdout: "FAIL app/x.test.ts", stderr: "" }, summaryOf({ "app/lib/a.ts": [100, 100] }));

    expect(checkFloors(shell, { "app/lib": 90 })).toBe(1);
    expect(err[0]).toMatch(/the unit tests failed/);
  });

  it("fails when vitest writes no summary, which is what a missing coverage provider looks like", () => {
    const { shell, err } = fakeShell(passed, undefined);

    expect(checkFloors(shell, { "app/lib": 90 })).toBe(1);
    expect(err[0]).toMatch(/@vitest\/coverage-v8/);
  });
});
