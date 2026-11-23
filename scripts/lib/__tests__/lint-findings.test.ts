import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { FORMAT_FIX } from "../lint-constants";
import {
  type Finding,
  formatFinding,
  parseBiome,
  parseHouse,
  parseKnip,
  sortFindings,
} from "../lint-findings";

const BIOME_FORMAT =
  '{"summary":{"changed":0,"unchanged":1,"matches":0,"duration":87897208,"errors":1,"warnings":0,"infos":0,"skipped":0,"suggestedFixesSkipped":0,"diagnosticsNotPrinted":0,"scannerDuration":2361579625},"diagnostics":[{"severity":"error","message":"Formatter would have printed the following content:","category":"format","location":{"path":"scripts/lint-all.ts","start":{"line":0,"column":0},"end":{"line":0,"column":0}},"advices":[]}],"command":"check"}';

const biomeDiagnostic = (over: { category?: string; message?: string; start?: { line: number; column: number } | null }) => ({
  severity: "error",
  message: over.message ?? "Unexpected any. Specify a different type.",
  category: over.category ?? "lint/suspicious/noExplicitAny",
  location: {
    path: "scripts/lint-all.ts",
    start: over.start === undefined ? { line: 3, column: 7 } : over.start,
    end: { line: 3, column: 10 },
  },
  advices: [],
});
const biomeReport = (diagnostics: readonly unknown[]): string =>
  JSON.stringify({ summary: { errors: diagnostics.length }, diagnostics, command: "check" });

const knipReport = (issues: readonly Record<string, unknown>[]): string => JSON.stringify({ issues });

const onlyFinding = (result: Either.Either<Finding[], string>): Finding | undefined =>
  Either.isRight(result) && result.right.length === 1 ? result.right[0] : undefined;

describe("parseBiome", () => {
  it("turns a lint diagnostic into path, line, column, category and Biome's message, so the finding points at the code", () => {
    expect(parseBiome(biomeReport([biomeDiagnostic({})]))).toEqual(
      Either.right([
        {
          path: "scripts/lint-all.ts",
          line: 3,
          column: 7,
          rule: "lint/suspicious/noExplicitAny",
          message: "Unexpected any. Specify a different type.",
        },
      ]),
    );
  });

  it("gives a format diagnostic no line and the run-format fix, so Biome's 'would have printed' text never reaches the reader", () => {
    const finding = onlyFinding(parseBiome(BIOME_FORMAT));
    expect(finding).toEqual({ path: "scripts/lint-all.ts", rule: "format", message: FORMAT_FIX });
    expect(finding?.message).toContain("bun run format");
    expect(finding && "line" in finding).toBe(false);
  });

  it("drops the position of a lint diagnostic at line 0 or with no start, so nothing prints as path:0", () => {
    const result = parseBiome(biomeReport([biomeDiagnostic({ start: { line: 0, column: 0 } }), biomeDiagnostic({ start: null })]));
    expect(Either.isRight(result)).toBe(true);
    const findings = Either.getOrElse(result, () => []);
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.line).toBeUndefined();
      expect(finding.column).toBeUndefined();
      expect(formatFinding(finding)).toBe("scripts/lint-all.ts lint/suspicious/noExplicitAny: Unexpected any. Specify a different type.");
    }
  });

  it("reads an empty diagnostics list as no findings, so a clean Biome run is not a tool failure", () => {
    expect(parseBiome(biomeReport([]))).toEqual(Either.right([]));
  });

  it.each([
    ["empty stdout", ""],
    ["plain text", "Biome crashed: the configuration is invalid"],
    ["an array", "[]"],
    ["no diagnostics key", '{"summary":{}}'],
    ["a diagnostic without a category", '{"diagnostics":[{"severity":"error","message":"m","location":{}}]}'],
  ])("returns left for %s, so a parse failure never reads as no findings", (_name, stdout) => {
    expect(Either.isLeft(parseBiome(stdout))).toBe(true);
  });
});

describe("parseKnip", () => {
  it.each<[string, Record<string, unknown>, Finding, string]>([
    [
      "an unused file",
      { file: "app/lib/old.ts", files: [{ name: "app/lib/old.ts" }] },
      { path: "app/lib/old.ts", rule: "knip/files", message: "" },
      "delete it",
    ],
    [
      "an unused dependency",
      { file: "package.json", dependencies: [{ name: "left-pad", line: 12, col: 6 }] },
      { path: "package.json", line: 12, column: 6, rule: "knip/dependencies", message: "" },
      "`left-pad`",
    ],
    [
      "an unused export",
      { file: "app/lib/a.ts", exports: [{ name: "helper", line: 4, col: 17 }] },
      { path: "app/lib/a.ts", line: 4, column: 17, rule: "knip/exports", message: "" },
      "`helper`",
    ],
    [
      "an unlisted import",
      { file: "app/lib/b.ts", unlisted: [{ name: "lodash" }] },
      { path: "app/lib/b.ts", rule: "knip/unlisted", message: "" },
      "`lodash`",
    ],
    [
      "a duplicate export",
      { file: "app/lib/c.ts", duplicates: [[{ name: "a", line: 2, col: 1 }, { name: "b", line: 3, col: 1 }]] },
      { path: "app/lib/c.ts", line: 2, column: 1, rule: "knip/duplicates", message: "" },
      "`a, b`",
    ],
  ])("turns %s into one knip/<kind> finding that names it and says what to do", (_name, issue, expected, named) => {
    const finding = onlyFinding(parseKnip(knipReport([issue])));
    expect(finding).toMatchObject({ ...expected, message: expect.stringContaining(named) });
    expect(finding?.message).toContain("Do this instead");
  });

  it("yields nothing for an issue whose arrays are all empty, so knip's per-file skeleton is not a finding", () => {
    const skeleton = { file: "app/lib/a.ts", files: [], dependencies: [], exports: [], types: [], unlisted: [], duplicates: [], enumMembers: [] };
    expect(parseKnip(knipReport([skeleton]))).toEqual(Either.right([]));
    expect(parseKnip('{"issues":[]}')).toEqual(Either.right([]));
  });

  it("keeps every finding of every issue, so a second file or kind is not dropped", () => {
    const result = parseKnip(
      knipReport([
        { file: "app/a.ts", exports: [{ name: "x" }, { name: "y" }], types: [{ name: "T" }] },
        { file: "app/b.ts", unresolved: [{ name: "./gone" }] },
      ]),
    );
    expect(Either.getOrElse(result, () => []).map((finding) => `${finding.path} ${finding.rule}`)).toEqual([
      "app/a.ts knip/exports",
      "app/a.ts knip/exports",
      "app/a.ts knip/types",
      "app/b.ts knip/unresolved",
    ]);
  });

  it.each(["subpaths", "optionalPeerDependencies", "namespaceMembers", "catalog", "catalogReferences"])(
    "turns a %s issue, which knip reports by default, into a finding instead of dropping it",
    (kind) => {
      const finding = onlyFinding(parseKnip(knipReport([{ file: "package.json", [kind]: [{ name: "thing", line: 1, col: 1 }] }])));
      expect(finding?.rule).toBe(`knip/${kind}`);
      expect(finding?.message).toContain("`thing`");
    },
  );

  it.each([
    ["empty stdout", ""],
    ["knip's preamble line", "Using latest D1 database: miniflare-D1DatabaseObject/abc.sqlite"],
    ["no issues key", '{"files":[]}'],
    ["an issue without a file", '{"issues":[{"exports":[]}]}'],
    ["a kind whose list has a shape the parser does not know", '{"issues":[{"file":"app/a.ts","exports":[{"symbol":"x"}]}]}'],
    ["a kind that is not a list", '{"issues":[{"file":"app/a.ts","dependencies":"lodash"}]}'],
  ])("returns left for %s, so a parse failure never reads as no findings", (_name, stdout) => {
    expect(Either.isLeft(parseKnip(stdout))).toBe(true);
  });
});

describe("parseHouse", () => {
  it("reads path:line and path:line:column findings, keeps colons inside the message and marks each rule as the house linter's", () => {
    const output = [
      "app/lib/a.ts:12 no-throw: use Effect.fail: see docs/effect.md",
      "app/lib/b.tsx:4:9 house/no-process-env: read the binding from CloudflareEnv",
      "scripts/lint/baseline.json:1 baseline-stale: lower the count",
    ].join("\n");
    expect(parseHouse(output)).toEqual([
      { path: "app/lib/a.ts", line: 12, rule: "house/no-throw", message: "use Effect.fail: see docs/effect.md" },
      { path: "app/lib/b.tsx", line: 4, column: 9, rule: "house/no-process-env", message: "read the binding from CloudflareEnv" },
      { path: "scripts/lint/baseline.json", line: 1, rule: "house/baseline-stale", message: "lower the count" },
    ]);
  });

  it("ignores summaries, command echoes and blank lines, so noise never becomes a finding", () => {
    const output = [
      "$ bun scripts/lint/cli.ts app/lib/a.ts",
      "",
      "house lint: 2 finding(s). Each line says the fix.",
      "house lint: clean. 518 file(s), 13 rule(s).",
      'error: script "lint:house" exited with code 1',
    ].join("\n");
    expect(parseHouse(output)).toEqual([]);
  });
});

describe("formatFinding", () => {
  it.each<[string, Finding, string]>([
    ["no line", { path: "app/a.ts", rule: "format", message: "m" }, "app/a.ts format: m"],
    ["a line", { path: "app/a.ts", line: 3, rule: "r", message: "m" }, "app/a.ts:3 r: m"],
    ["a line and column", { path: "app/a.ts", line: 3, column: 7, rule: "r", message: "m" }, "app/a.ts:3:7 r: m"],
    ["a column without a line", { path: "app/a.ts", column: 7, rule: "r", message: "m" }, "app/a.ts r: m"],
  ])("prints a finding with %s in the one shape", (_name, finding, expected) => {
    expect(formatFinding(finding)).toBe(expected);
  });
});

describe("sortFindings", () => {
  it("orders by path, then line, then column, and leaves its input untouched", () => {
    const input: Finding[] = [
      { path: "b.ts", line: 1, rule: "r", message: "m" },
      { path: "a.ts", line: 10, column: 2, rule: "r", message: "m" },
      { path: "a.ts", line: 2, column: 9, rule: "r", message: "m" },
      { path: "a.ts", line: 10, column: 1, rule: "r", message: "m" },
      { path: "a.ts", rule: "format", message: "m" },
    ];
    const before = structuredClone(input);
    expect(sortFindings(input).map(formatFinding)).toEqual([
      "a.ts format: m",
      "a.ts:2:9 r: m",
      "a.ts:10:1 r: m",
      "a.ts:10:2 r: m",
      "b.ts:1 r: m",
    ]);
    expect(input).toEqual(before);
  });
});
