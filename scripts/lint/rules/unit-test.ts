import ts from "typescript";
import { MIN_TEST_FILE_CHARS, UNIT_TEST_DIRS } from "../constants";
import { isTestPath, lineOf, walkNodes } from "../source";
import type { Hit, Repo, RepoRule, Source } from "../types";

const TS_FILE = /\.ts$/;
const ASSERT_CALLEES = new Set(["expect", "assert"]);
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

const hasExportKeyword = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  ) ?? false;

const isValueDeclaration = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node);

const firstExportedValue = (ast: ts.SourceFile): ts.Node | undefined =>
  ast.statements.find((node) => hasExportKeyword(node) && isValueDeclaration(node));

function isAssertion(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return ASSERT_CALLEES.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "assert";
}

function loadsModule(node: ts.Node, subject: RegExp): boolean {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return false;
  const specifier = node.moduleSpecifier;
  return specifier !== undefined && ts.isStringLiteralLike(specifier) && subject.test(specifier.text);
}

function weakTest(test: Source, stem: string): string | undefined {
  if (test.text.trim().length < MIN_TEST_FILE_CHARS) return "the test file is close to empty";
  const subject = new RegExp(`(^|/)${stem.replace(REGEX_SPECIALS, "\\$&")}(\\.[jt]s)?$`);
  let asserts = false;
  let imports = false;
  walkNodes(test.ast, (node) => {
    asserts ||= isAssertion(node);
    imports ||= loadsModule(node, subject);
  });
  if (!asserts) return "the test has no `expect()` or `assert()` call outside a comment";
  if (!imports) return `the test never imports "${stem}", the module it is named after`;
  return undefined;
}

function checkModule(repo: Repo, path: string): Hit | undefined {
  const source = repo.source(path);
  const exported = source && firstExportedValue(source.ast);
  if (!source || !exported) return undefined;
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash);
  const stem = path.slice(slash + 1).replace(TS_FILE, "");
  const expected = `${dir}/__tests__/${stem}.test.ts`;
  const test = repo.source(expected) ?? repo.source(`${dir}/${stem}.test.ts`);
  if (!test) {
    return { file: path, line: lineOf(source.ast, exported), message: `exports values and has no unit test at ${expected}` };
  }
  const weakness = weakTest(test, stem);
  return weakness
    ? { file: test.path, line: 1, message: weakness, fix: `import what ${path} exports and assert on what it returns` }
    : undefined;
}

const HELPER = "export function helper(a: number) { return a + 1; }\n";
const REAL_TEST =
  'import { describe, it, expect } from "vitest";\n' +
  'import { helper } from "../helper";\n' +
  'describe("helper", () => { it("adds", () => { expect(helper(1)).toBe(2); }); });\n';
const withTest = (test: string): Record<string, string> => ({
  "app/lib/helper.ts": HELPER,
  "app/lib/__tests__/helper.test.ts": test,
});

export const rule: RepoRule = {
  id: "unit-test",
  scope: "repo",
  nonNegotiable: 4,
  matches:
    "A `.ts` module that exports a function, class or value and has no unit test beside it, " +
    "or whose test is close to empty, asserts nothing, or never imports the module.",
  covers: `${UNIT_TEST_DIRS.map((dir) => `\`${dir}/\``).join(" and ")}, every level deep. A module that exports only types needs no test.`,
  fix: "add `__tests__/<name>.test.ts` beside the module; the test imports the module and asserts on what it returns",
  example: "app/lib/__tests__/date-utils.test.ts",
  check(repo) {
    return UNIT_TEST_DIRS.flatMap((dir) => repo.files(dir))
      .filter((path) => TS_FILE.test(path) && !isTestPath(path))
      .flatMap((path) => checkModule(repo, path) ?? []);
  },
  cases: [
    { name: "an exported helper with no test file is caught", files: { "app/lib/helper.ts": HELPER }, expect: "finding" },
    { name: "an exported helper with a real test is clean", files: withTest(REAL_TEST), expect: "clean" },
    {
      name: "a test file beside the module, outside __tests__, also counts",
      files: { "app/lib/helper.ts": HELPER, "app/lib/helper.test.ts": REAL_TEST.replace("../helper", "./helper") },
      expect: "clean",
    },
    { name: "a test file that is close to empty is not a test", files: withTest("// todo\n"), expect: "finding" },
    {
      name: "a test whose assertions are all commented out is not a test",
      files: withTest(
        'import { helper } from "../helper";\n' +
          '// describe("helper", () => { it("adds", () => { expect(helper(1)).toBe(2); }); });\n' +
          "// more commentary to clear the minimum length\n"
      ),
      expect: "finding",
    },
    {
      name: "a test that imports the module and asserts nothing is not a test",
      files: withTest('import { helper } from "../helper";\nvoid helper;\nconst padding = "xxxxxxxxxxxxxxxxxxxxxxxxxxxx";\n'),
      expect: "finding",
    },
    {
      name: "a test that asserts and never imports the module is not a test",
      files: withTest('import { expect, it } from "vitest";\nit("x", () => { expect(1).toBe(1); });\n'),
      expect: "finding",
    },
    { name: "a module that exports only types needs no test", files: { "app/lib/kinds.ts": "export type A = { a: number };\n" }, expect: "clean" },
    { name: "nested folders are checked, not only the top level", files: { "app/lib/schemas/user.ts": HELPER }, expect: "finding" },
    { name: "repositories are checked as well as app/lib", files: { "app/repositories/user.ts": HELPER }, expect: "finding" },
    { name: "a module outside the covered folders is not checked", files: { "app/services/thing.ts": HELPER }, expect: "clean" },
  ],
};
