import { describe, expect, it } from "vitest";
import { ROUTES_FILE, TEST_MAP_PATH } from "../../constants";
import { memoryRepo } from "../../repo";
import { sourceOf } from "../../__tests__/fixtures";
import type { MapEntry } from "../map";
import { proofProblems, rule } from "../../rules/test-map";
import { firstRuntimeStatement } from "../proofs";

const UNIT: MapEntry = { match: "app/lib/**", kind: "unit" };

const firstCode = (text: string): string | undefined => {
  const { ast } = sourceOf(text);
  return firstRuntimeStatement(ast)?.getText(ast);
};

const HELPER = 'import { Effect } from "effect";\nimport type { User } from "@/models/user";\n\nexport type Id = string;\nexport function helper(user: User) { return Effect.succeed(user); }\n';
const TSX_TEST = 'import { expect, it } from "vitest";\nimport { helper } from "../helper";\nit("wraps", () => { expect(helper).toBeDefined(); });\n';

describe("firstRuntimeStatement", () => {
  it.each([
    ['import { a } from "./a";\nimport "./polyfill";'],
    ['export { a } from "./a";\nexport * from "./b";\nexport type { C } from "./c";'],
    ["type A = { a: number };\nexport type B = A[];"],
    ["interface A { a: number }\nexport interface B extends A { b: string }"],
    ['declare const a: number;\ndeclare module "x" { const b: number; }\ndeclare global { interface Window { c: number } }\nexport declare function d(): void;'],
    [";\n"],
  ])("finds no code in a file of imports, re-exports, types, interfaces and declare statements: %s", (text) => {
    expect(firstCode(text)).toBeUndefined();
  });

  it.each([
    ["type A = number;\nrun();", "run();"],
    ["import { make } from './make';\nexport default make();", "export default make();"],
    ["interface A { a: number }\nexport const a: A = { a: 1 };", "export const a: A = { a: 1 };"],
    ["export function f() { return 1; }", "export function f() { return 1; }"],
    ["export class C {}", "export class C {}"],
    ["export enum E { A }", "export enum E { A }"],
  ])("treats a bare call, an export default value, an exported const, a function, a class and an enum as code: %s", (text, expected) => {
    expect(firstCode(text)).toBe(expected);
  });
});

describe("proofProblems unit", () => {
  it("puts a missing unit test on the line of the first runtime statement, not on line 1 of the imports", () => {
    const problems = proofProblems(memoryRepo({ "app/lib/helper.ts": HELPER }), "app/lib/helper.ts", UNIT);

    expect(problems).toEqual([
      {
        line: 5,
        message: "has no unit test at app/lib/__tests__/helper.test.ts",
        fix: "add app/lib/__tests__/helper.test.ts; it imports this file and asserts on what it returns",
        example: "app/lib/__tests__/date-utils.test.ts",
        related: ["app/lib/__tests__/helper.test.ts", "app/lib/__tests__/helper.test.tsx"],
      },
    ]);
  });

  it("names a .tsx file's expected test as .test.ts, with the extension stripped from the base name", () => {
    const [problem] = proofProblems(memoryRepo({ "app/lib/view.tsx": "export const View = () => null;\n" }), "app/lib/view.tsx", UNIT);

    expect(problem?.message).toBe("has no unit test at app/lib/__tests__/view.test.ts");
  });

  it("accepts a .test.tsx beside where the .test.ts would be as the unit test", () => {
    const repo = memoryRepo({ "app/lib/helper.ts": HELPER, "app/lib/__tests__/helper.test.tsx": TSX_TEST });

    expect(proofProblems(repo, "app/lib/helper.ts", UNIT)).toEqual([]);
  });

  it("checks a .test.tsx it found by that path, so its problems name the file that exists", () => {
    const repo = memoryRepo({
      "app/lib/helper.ts": HELPER,
      "app/lib/__tests__/helper.test.tsx": TSX_TEST.replace("../helper", "../other"),
    });

    expect(proofProblems(repo, "app/lib/helper.ts", UNIT)).toMatchObject([
      { file: "app/lib/__tests__/helper.test.tsx", message: "this test never imports app/lib/helper.ts, the file it is named after" },
    ]);
  });
});

describe("the rule in file mode", () => {
  const map = JSON.stringify({ entries: [UNIT] });
  const weakTest = 'import { it } from "vitest";\nimport { helper } from "../helper";\nit("runs", () => { void helper; });\n';
  const repo = () => memoryRepo({ [TEST_MAP_PATH]: map, "app/lib/helper.ts": HELPER, "app/lib/__tests__/helper.test.ts": weakTest });

  it("reports a weak test on the test file when only the test is named, so editing a test to assert nothing fails the edit hook", () => {
    const hits = rule.check(repo(), new Set(["app/lib/__tests__/helper.test.ts"]));

    expect(hits).toMatchObject([{ file: "app/lib/__tests__/helper.test.ts", line: 1 }]);
    expect(hits[0]?.message).toContain("no `expect()` or `assert()` call");
  });

  it("checks nothing when the named files are neither a source file nor its test", () => {
    expect(rule.check(repo(), new Set(["app/lib/other.ts"]))).toEqual([]);
  });
});

describe("proofProblems declaration", () => {
  it("puts code in a declaration file on the line where that code starts", () => {
    const repo = memoryRepo({ "app/lib/kinds.ts": "export type A = number;\n\nexport const a = 1;\n" });

    expect(proofProblems(repo, "app/lib/kinds.ts", { match: "app/lib/kinds.ts", kind: "declaration" })).toMatchObject([{ line: 3 }]);
  });
});

describe("proofProblems component", () => {
  it("tells a new component with no sandbox to add a covered-by entry for its own path above the broader glob", () => {
    const repo = memoryRepo({ "app/components/new-card.tsx": "export function NewCard() { return null; }\n" });

    const [problem] = proofProblems(repo, "app/components/new-card.tsx", { match: "app/components/**", kind: "component" });

    expect(problem?.message).toBe("no file under app/routes/sandbox/ renders it");
    expect(problem?.fix).toContain('{ "match": "app/components/new-card.tsx", "kind": "covered-by", "test": "e2e/<spec>.spec.ts", "reason": "…" }');
    expect(problem?.fix).toContain(`named in ${TEST_MAP_PATH}`);
    expect(problem?.fix).toContain("Write the spec first");
  });
});

describe("proofProblems route", () => {
  it("names every path a page is served at, and points the fix at the first", () => {
    const table =
      'import { index, prefix } from "@react-router/dev/routes";\n' +
      'export default [index("routes/home.tsx"), ...prefix(":lng", [index("routes/home.tsx")])];\n';
    const repo = memoryRepo({ [ROUTES_FILE]: table, "app/routes/home.tsx": "export default function Home() { return null; }\n" });

    const [problem] = proofProblems(repo, "app/routes/home.tsx", { match: "app/routes/**", kind: "route" });

    expect(problem?.message).toBe("no e2e spec that holds an @golden and an @error test visits / or /:lng");
    expect(problem?.fix).toContain('`page.goto("/")`');
  });
});
