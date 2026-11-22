import { describe, expect, it } from "vitest";
import { memoryRepo } from "../repo";
import { rule as taggedErrorMapped } from "../rules/tagged-error-mapped";
import { applySuppression, runRules } from "../run";
import type { FileHit } from "../types";
import { badWordRule, listedHitsRule, sourceOf } from "./fixtures";

const roots = () => ["app", "workers"];

const places = (findings: { file: string; line: number; rule: string }[]) =>
  findings.map((entry) => `${entry.file}:${entry.line} ${entry.rule}`);

describe("runRules", () => {
  it("walks only the roots it is given, so scripts and config stay out of a whole-repo run", () => {
    const repo = memoryRepo({ "app/a.ts": "BAD", "workers/w.ts": "BAD", "scripts/s.ts": "BAD" });

    expect(places(runRules([badWordRule()], repo, roots()).findings)).toEqual(["app/a.ts:1 no-bad", "workers/w.ts:1 no-bad"]);
  });

  it("with only set, runs a file rule on the named files alone and filters a repo rule's findings to them", () => {
    const repo = memoryRepo({ "app/a.ts": "BAD", "app/b.ts": "BAD" });
    const repoRule = listedHitsRule([
      { file: "app/a.ts", line: 2, message: "repo hit" },
      { file: "app/b.ts", line: 2, message: "repo hit" },
    ]);

    const result = runRules([badWordRule(), repoRule], repo, roots(), new Set(["app/a.ts"]));

    expect(places(result.findings)).toEqual(["app/a.ts:1 no-bad", "app/a.ts:2 repo-hits"]);
  });

  it("with only set, ignores a path that is not .ts or .tsx and a path that does not exist", () => {
    const repo = memoryRepo({ "app/a.ts": "BAD", "app/notes.md": "BAD" });

    const result = runRules([badWordRule()], repo, roots(), new Set(["app/notes.md", "app/missing.ts", "app/a.ts"]));

    expect(places(result.findings)).toEqual(["app/a.ts:1 no-bad"]);
    expect(result.filesChecked).toBe(1);
  });

  it("sorts findings by file, then line, then rule, whatever order the rules report them in", () => {
    const repo = memoryRepo({ "app/b.ts": "BAD", "app/a.ts": "ok\nok\nBAD" });
    const late = listedHitsRule([{ file: "app/a.ts", line: 1, message: "z" }], { id: "z-rule" });
    const early = listedHitsRule([{ file: "app/a.ts", line: 3, message: "a" }], { id: "a-rule" });

    expect(places(runRules([late, badWordRule(), early], repo, roots()).findings)).toEqual([
      "app/a.ts:1 z-rule",
      "app/a.ts:3 a-rule",
      "app/a.ts:3 no-bad",
      "app/b.ts:1 no-bad",
    ]);
  });

  it("counts in filesChecked only the files some rule applies to", () => {
    const repo = memoryRepo({ "app/lib/x.ts": "ok", "app/routes/y.tsx": "ok", "app/lib/z.ts": "ok" });
    const libOnly = badWordRule({ applies: (path) => path.startsWith("app/lib/") });

    expect(runRules([libOnly], repo, roots()).filesChecked).toBe(2);
  });

  it("keeps a hit's own fix over the rule's and carries the rule's example onto every finding", () => {
    const rule = badWordRule({
      example: "app/good.ts",
      check: () => [{ line: 1, message: "own fix", fix: "do the specific thing" }, { line: 2, message: "rule fix" }],
    });

    const [own, fallback] = runRules([rule], memoryRepo({ "app/a.ts": "x" }), roots()).findings;

    expect(own).toMatchObject({ fix: "do the specific thing", example: "app/good.ts", file: "app/a.ts" });
    expect(fallback).toMatchObject({ fix: "write GOOD", example: "app/good.ts" });
  });

  it("adds up the suppression markers with a reason across every file", () => {
    const rule = badWordRule({ suppressionMarker: "bad-ok:" });
    const repo = memoryRepo({ "app/a.ts": "// bad-ok: one\nBAD", "app/b.ts": "// bad-ok: two\nBAD" });

    expect(runRules([rule], repo, roots())).toMatchObject({ findings: [], suppressions: 2 });
  });
});

describe("runRules in file mode with a rule that compares files", () => {
  const errorFile = () => 'import { Data } from "effect";\nexport class BoomError extends Data.TaggedError("BoomError")<{}> {}\n';
  const mapperWithoutBoom = () => 'export function appErrorToTRPC(tag: string) { switch (tag) { case "OtherError": return 1; } }\n';
  const repo = () => memoryRepo({ "app/models/errors/boom.ts": errorFile(), "app/lib/effect-trpc.ts": mapperWithoutBoom(), "app/lib/other.ts": "export {};\n" });

  it("keeps the finding on the error class when only the mapper is named, so removing a mapping case is not reported clean", () => {
    const result = runRules([taggedErrorMapped], repo(), roots(), new Set(["app/lib/effect-trpc.ts"]));

    expect(places(result.findings)).toEqual(["app/models/errors/boom.ts:2 tagged-error-mapped"]);
  });

  it("still drops that finding when the named file is neither the error class nor a file it depends on", () => {
    const result = runRules([taggedErrorMapped], repo(), roots(), new Set(["app/lib/other.ts"]));

    expect(result.findings).toEqual([]);
  });
});

describe("applySuppression", () => {
  const suppressible = () => badWordRule({ suppressionMarker: "bad-ok:" });
  const hitsIn = (text: string): FileHit[] => suppressible().check(sourceOf(text), memoryRepo({}));
  const suppress = (text: string) => applySuppression(suppressible(), sourceOf(text), hitsIn(text));

  it("excuses a hit on the marker's own line and on the next line, and no further", () => {
    const result = suppress("BAD // bad-ok: generated\nok\n// bad-ok: cannot reject\nBAD\nBAD");

    expect(result.hits.map((hit) => hit.line)).toEqual([5]);
    expect(result.count).toBe(2);
  });

  it.each([
    ["a line comment", "// bad-ok:\nBAD"],
    ["a block comment, whose closing */ is not a reason", "/* bad-ok: */\nBAD"],
    ["a JSX comment, whose closing */} is not a reason", "{/* bad-ok: */}\nBAD"],
  ])("a marker with no reason in %s excuses nothing and is itself a finding", (_name, text) => {
    const result = suppress(text);

    expect(result.hits.map((hit) => [hit.line, hit.message])).toEqual([
      [2, "BAD found"],
      [1, "`bad-ok:` has no reason, so it excuses nothing"],
    ]);
    expect(result.count).toBe(0);
  });

  it("reports a marker with a reason that excuses no hit, and still counts it", () => {
    const result = suppress("// bad-ok: left behind\nok");

    expect(result.hits.map((hit) => [hit.line, hit.message])).toEqual([[1, "`bad-ok:` excuses nothing on its own lines or the line after"]]);
    expect(result.count).toBe(1);
  });

  it("reads a marker only from a comment, so the same text in a string excuses nothing and is not counted", () => {
    const result = suppress('const note = "bad-ok: example"; BAD');

    expect(result.hits.map((hit) => [hit.line, hit.message])).toEqual([[1, "BAD found"]]);
    expect(result.count).toBe(0);
  });

  it("reports nothing for a string that holds the marker's text in a file with no hit", () => {
    expect(suppress('const note = "bad-ok: example";')).toEqual({ hits: [], count: 0 });
  });

  it("takes a marker only at the start of its comment, so prose that mentions it is not a suppression", () => {
    const result = suppress("// see the docs on bad-ok: for how to excuse a line\nBAD");

    expect(result.hits.map((hit) => hit.message)).toEqual(["BAD found"]);
    expect(result.count).toBe(0);
  });

  it("excuses the line after a comment that spans several lines, counted from the line the comment ends on", () => {
    const result = suppress("/* bad-ok: generated by the build,\n   and checked there */\nBAD\nBAD");

    expect(result.hits.map((hit) => hit.line)).toEqual([4]);
    expect(result.count).toBe(1);
  });

  it("passes every hit through when the rule has no suppression, even next to marker text", () => {
    const text = "// bad-ok: looks like a marker\nBAD";
    const hits = hitsIn(text);

    expect(applySuppression(badWordRule(), sourceOf(text), hits)).toEqual({ hits, count: 0 });
  });
});
