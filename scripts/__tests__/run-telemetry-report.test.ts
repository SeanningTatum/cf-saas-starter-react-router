import { describe, it, expect } from "vitest";
import { run } from "../run-telemetry";
import { summaryLines } from "../lib/run-telemetry-report";
import { RUN_PATH, err, memory, runFile, stored, text, tokens } from "./fixtures/run-telemetry/helpers";

describe("summary", () => {
  const full = (n: number, phase: string, over: Record<string, unknown> = {}) =>
    stored(n, { phase, label: `c${n}`, tokens: tokens(100 * (n + 1), 10 * (n + 1)), seconds: 10 * (n + 1), ...over });

  it("prints n/a for a column where every call is null: a zero would read as a measurement", () => {
    const { deps } = memory({ [RUN_PATH]: runFile({ "ship-feature": [stored(0), stored(1, { phase: "Build" })] }) });
    const o = run(["summary", "demo"], deps);
    expect(o.code).toBe(0);
    const total = o.stdout.find((l) => l.startsWith("total")) ?? "";
    expect(total.match(/n\/a/g)?.length).toBe(3);
    expect(o.stdout.join("\n")).not.toContain("*");
  });

  it("sums known values, marks a mix with * and says how many calls had no data: a partial sum must not pass as whole", () => {
    const calls = [full(0, "Audit"), stored(1, { phase: "Audit", label: "c1" }), full(2, "Build")];
    const { deps } = memory({ [RUN_PATH]: runFile({ "ship-feature": calls }) });
    const lines = run(["summary", "demo"], deps).stdout;
    const audit = lines.find((l) => l.startsWith("Audit")) ?? "";
    const total = lines.find((l) => l.startsWith("total")) ?? "";
    expect(audit).toContain("100*");
    expect(total).toContain("400*");
    expect(total).toContain("40.0*");
    expect(lines[lines.length - 1]).toBe("* partial sum: 1 of 3 calls had no token data; 1 of 3 calls had no timing");
  });

  it("counts retries by attempt and failures by outcome: a threw and an empty are both failed", () => {
    const calls = [
      full(0, "Audit"),
      full(1, "Audit", { attempt: 2 }),
      full(2, "Audit", { outcome: "threw" }),
      full(3, "Audit", { outcome: "empty" }),
    ];
    const { deps } = memory({ [RUN_PATH]: runFile({ w: calls }) });
    const row = run(["summary", "demo"], deps).stdout.find((l) => l.startsWith("Audit")) ?? "";
    expect(row.split(/\s+/).slice(0, 4)).toEqual(["Audit", "4", "1", "2"]);
  });

  it("keeps phases in first-seen order and one table per workflow: the table must read like the run did", () => {
    const calls = [full(0, "Preflight"), full(1, "Build"), full(2, "Preflight")];
    const { deps } = memory({ [RUN_PATH]: runFile({ a: calls, b: [full(0, "Only")] }) });
    const lines = run(["summary", "demo"], deps).stdout;
    const names = lines.map((l) => l.split(/\s+/)[0]);
    expect(names.indexOf("Preflight")).toBeLessThan(names.indexOf("Build"));
    expect(lines.filter((l) => l.startsWith("phase")).length).toBe(2);
  });

  it("--markdown prints GitHub tables: the PR body pastes straight in", () => {
    const { deps } = memory({ [RUN_PATH]: runFile({ w: [full(0, "Audit"), stored(1, { phase: "Audit", label: "x" })] }) });
    const lines = run(["summary", "demo", "--markdown"], deps).stdout;
    expect(lines).toContain("| phase | calls | retries | failed | tokens in | tokens out | seconds |");
    expect(lines).toContain("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    expect(lines.some((l) => l.startsWith("| total | 2 | 0 | 0 | 100* |"))).toBe(true);
  });

  it("exits 1 when nothing was recorded for the slug: silence would look like an empty run", () => {
    const o = run(["summary", "demo"], memory().deps);
    expect(o.code).toBe(1);
    expect(err(o)).toContain("nothing was recorded");
  });

  it("escapes pipes, newlines, angle brackets and @ in markdown cells and the heading, and leaves plain text alone: a hand-edited phase must not break or inject into a PR body", () => {
    const nasty = "a|b\n<img src=x> @octocat";
    const { deps } = memory({ [RUN_PATH]: runFile({ w: [full(0, nasty)] }) });
    const md = run(["summary", "demo", "--markdown"], deps).stdout;
    const hand = { version: 1 as const, slug: "demo", workflows: { "w@x": { calls: [] } } };
    expect(summaryLines(hand, true)[0]).toBe("**w(at)x (demo)**");
    const row = md.find((l) => l.includes("octocat")) ?? "";
    expect(row.startsWith("| a\\|b &lt;img src=x> (at)octocat | 1 |")).toBe(true);
    const plain = run(["summary", "demo"], deps).stdout;
    expect(plain.join("\n")).toContain("a|b\n<img src=x> @octocat");
  });

  it("starts the markdown footnote with an escaped star so GitHub does not render a bullet: the note must stay a note", () => {
    const { deps } = memory({ [RUN_PATH]: runFile({ w: [full(0, "Audit"), stored(1, { phase: "Audit", label: "x" })] }) });
    const md = run(["summary", "demo", "--markdown"], deps).stdout;
    expect(md[md.length - 1]?.startsWith("\\* partial sum:")).toBe(true);
    const plain = run(["summary", "demo"], deps).stdout;
    expect(plain[plain.length - 1]?.startsWith("* partial sum:")).toBe(true);
  });
});

describe("stats", () => {
  const fullCall = (label: string, agent: string, over: Record<string, unknown> = {}) =>
    stored(0, { label, agent, phase: "Build", tokens: tokens(100, 20), seconds: 30, ...over });

  const files = () => ({
    "/repo/.verify/alpha/run.json": runFile(
      { "ship-feature": [fullCall("a", "runner"), fullCall("b", "ui-builder", { phase: "UI", seconds: 100, outcome: "threw" }), fullCall("c", "runner", { outcome: "threw" })] },
      "alpha",
    ),
    "/repo/.verify/beta/run.json": runFile({ "ship-feature": [fullCall("d", "ui-builder", { outcome: "empty", seconds: 5 })] }, "beta"),
    "/repo/.verify/beta/verdict.md": "notes",
  });

  it("prints cost per feature, the slowest phase and failure rate by agent, worst first: the three blocks the ticket asks for", () => {
    const o = run(["stats"], memory(files()).deps);
    expect(o.code).toBe(0);
    const out = text(o);
    expect(out).toContain("Cost per feature");
    expect(out).toMatch(/alpha\s+3\s+300\s+60\s+160\.0/);
    expect(out).toMatch(/beta\s+1\s+100\s+20\s+5\.0/);
    expect(out).toContain("ship-feature / UI, 100.0 seconds");
    const rows = out.split("\n").filter((l) => /^(runner|ui-builder)\s/.test(l));
    expect(rows[0]).toMatch(/^ui-builder\s+2\s+2\s+100\.0%/);
    expect(rows[1]).toMatch(/^runner\s+1\s+2\s+50\.0%/);
  });

  it("sums seconds over features for the slowest phase: one long feature must not hide a slow phase everywhere", () => {
    const more = {
      "/repo/.verify/a/run.json": runFile({ w: [stored(0, { phase: "Docs", seconds: 60 }), stored(1, { phase: "Build", seconds: 50, label: "x" })] }, "a"),
      "/repo/.verify/b/run.json": runFile({ w: [stored(0, { phase: "Docs", seconds: 60 })] }, "b"),
    };
    expect(text(run(["stats"], memory(more).deps))).toContain("w / Docs, 120.0 seconds");
  });

  it("prints n/a when no call has seconds: the slowest phase cannot be guessed", () => {
    const none = { "/repo/.verify/a/run.json": runFile({ w: [stored(0)] }, "a") };
    const out = text(run(["stats"], memory(none).deps));
    expect(out).toContain("Slowest phase\nn/a");
    expect(out).toMatch(/^a\s+1\s+n\/a\s+n\/a\s+n\/a$/m);
  });

  it("reads another directory with --dir and gives GitHub tables with --markdown: a CI folder is not .verify", () => {
    const other = { "/elsewhere/x/run.json": runFile({ w: [stored(0)] }, "x") };
    const o = run(["stats", "--dir", "/elsewhere", "--markdown"], memory(other).deps);
    expect(o.stdout).toContain("**Cost per feature**");
    expect(o.stdout).toContain("| feature | calls | tokens in | tokens out | seconds |");
  });

  it("skips a broken run.json with a warning and keeps going: one bad feature must not hide the rest", () => {
    const mixed = { ...files(), "/repo/.verify/broken/run.json": "oops" };
    const o = run(["stats"], memory(mixed).deps);
    expect(o.code).toBe(0);
    expect(err(o)).toContain("skipped broken/run.json");
    expect(text(o)).toContain("alpha");
  });

  it("warns about an entry whose read throws and prints the others: a stray file must not end the command", () => {
    const { deps } = memory(files());
    const readFile = (path: string) => {
      if (path.includes(".DS_Store")) throw new Error("ENOTDIR: not a directory");
      return deps.readFile(path);
    };
    const o = run(["stats"], { ...deps, readFile, listDir: (p) => [...deps.listDir(p), ".DS_Store"] });
    expect(o.code).toBe(0);
    expect(o.stderr).toEqual(["run-telemetry: skipped .DS_Store: ENOTDIR: not a directory"]);
    expect(text(o)).toContain("alpha");
  });

  it("says so when there is nothing to read: an empty table would look like a result", () => {
    const o = run(["stats"], memory().deps);
    expect(o.code).toBe(0);
    expect(text(o)).toBe("run-telemetry: no run.json files in .verify");
  });
});

