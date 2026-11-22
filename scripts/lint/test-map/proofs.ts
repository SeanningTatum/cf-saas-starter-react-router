import ts from "typescript";
import { E2E_DIR, E2E_SPEC, MIN_TEST_FILE_CHARS, SANDBOX_DIR, SANDBOX_ISSUE, SOURCE_FILE, TEST_MAP_PATH } from "../constants";
import { isLiteralConstant } from "../literals";
import { isSourcePath, isTestPath, lineOf, walkNodes } from "../source";
import type { Repo, Source } from "../types";
import { importedModules, importsFile } from "./imports";
import type { MapEntry } from "./map";

export interface Problem {
  file?: string;
  line?: number;
  message: string;
  fix: string;
  example?: string;
  related?: string[];
}

const DECLARATION_FILE = /\.d\.ts$/;
const MACHINE_SUFFIX = /\.machine\.ts$/;
const PARENT_SEGMENT = /(^|\/)\.\.(\/|$)/;
const ASSERT_CALLEES = new Set(["expect", "assert"]);
const EXPECT_VARIANTS = new Set(["soft", "poll"]);
const TEST_EXTENSIONS = ["ts", "tsx"];
const UNIT_TEST_EXAMPLE = "app/lib/__tests__/date-utils.test.ts";

export const splitPath = (path: string): { dir: string; name: string } => {
  const slash = path.lastIndexOf("/");
  return { dir: path.slice(0, slash), name: path.slice(slash + 1).replace(SOURCE_FILE, "") };
};

const isDeclared = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword
  ) ?? false;

const isTypeOnly = (node: ts.Statement): boolean =>
  ts.isImportDeclaration(node) ||
  ts.isExportDeclaration(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isEmptyStatement(node) ||
  isDeclared(node);

export const firstRuntimeStatement = (ast: ts.SourceFile): ts.Statement | undefined =>
  ast.statements.find((statement) => !isTypeOnly(statement));

export const firstLogicStatement = (ast: ts.SourceFile): ts.Statement | undefined =>
  ast.statements.find((statement) => !isTypeOnly(statement) && !isLiteralConstant(statement));

function isAssertion(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return ASSERT_CALLEES.has(callee.text);
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
  const owner = callee.expression.text;
  return owner === "assert" || (owner === "expect" && EXPECT_VARIANTS.has(callee.name.text));
}

export function asserts(test: Source): boolean {
  let found = false;
  walkNodes(test.ast, (node) => {
    found ||= isAssertion(node);
  });
  return found;
}

export function emptyTest(test: Source): Problem | undefined {
  if (test.text.trim().length < MIN_TEST_FILE_CHARS) {
    return { file: test.path, message: "this test file is close to empty", fix: "write a test here that asserts on what its subject does" };
  }
  if (!asserts(test)) {
    return {
      file: test.path,
      message: "this test has no `expect()` or `assert()` call outside a comment",
      fix: "assert on what its subject returns or does",
    };
  }
  return undefined;
}

export const unitTestPaths = (path: string): string[] => {
  const { dir, name } = splitPath(path);
  return TEST_EXTENSIONS.map((extension) => `${dir}/__tests__/${name}.test.${extension}`);
};

export function unitProblems(repo: Repo, path: string): Problem[] {
  const source = repo.source(path);
  const runtime = source && firstLogicStatement(source.ast);
  if (!source || !runtime) return [];
  const candidates = unitTestPaths(path);
  const test = candidates.map((candidate) => repo.source(candidate)).find((found) => found !== undefined);
  const expected = candidates[0];
  if (!test) {
    return [
      {
        line: lineOf(source.ast, runtime),
        message: `has no unit test at ${expected}`,
        fix: `add ${expected}; it imports this file and asserts on what it returns`,
        example: UNIT_TEST_EXAMPLE,
        related: candidates,
      },
    ];
  }
  const empty = emptyTest(test);
  if (empty) return [empty];
  if (importsFile(test, path)) return [];
  return [{ file: test.path, message: `this test never imports ${path}, the file it is named after`, fix: `import ${path} here and assert on what it exports` }];
}

export function machineProblems(repo: Repo, path: string): Problem[] {
  const base = path.replace(MACHINE_SUFFIX, "");
  const spec = `${E2E_DIR}/${splitPath(base).name}.paths.spec.ts`;
  const found = repo.source(spec);
  const fix = `add ${spec}: replay the machine's generated paths in the browser, one per DOM binding and per state's view, and assert on each`;
  if (!found) return [...unitProblems(repo, path), { message: `has no paths spec at ${spec}`, fix, related: [spec] }];
  const wired = importedModules(found).some((module) => module.startsWith(`${base}.`));
  if (!wired) return [...unitProblems(repo, path), { message: `its paths spec ${spec} imports neither the machine nor its model`, fix, related: [spec] }];
  return asserts(found) ? unitProblems(repo, path) : [...unitProblems(repo, path), { message: `its paths spec ${spec} asserts nothing`, fix, related: [spec] }];
}

export function sandboxProblems(repo: Repo, path: string): Problem[] {
  const shown = repo
    .files(SANDBOX_DIR)
    .filter(isSourcePath)
    .some((entry) => {
      const source = repo.source(entry);
      return source !== undefined && importsFile(source, path);
    });
  if (shown) return [];
  return [
    {
      message: `no file under ${SANDBOX_DIR}/ renders it`,
      fix:
        `render it in a file under ${SANDBOX_DIR}/. The sandbox arrives with ${SANDBOX_ISSUE}; until then a new component needs an e2e spec that ` +
        `exercises it, named in ${TEST_MAP_PATH}: \`{ "match": "${path}", "kind": "covered-by", "test": "e2e/<spec>.spec.ts", "reason": "…" }\` ` +
        "above the broader glob. Write the spec first; the entry only points at it",
    },
  ];
}

export function declarationProblems(repo: Repo, path: string): Problem[] {
  const source = repo.source(path);
  const runtime = source && !DECLARATION_FILE.test(path) ? firstRuntimeStatement(source.ast) : undefined;
  if (!source || !runtime) return [];
  return [
    {
      line: lineOf(source.ast, runtime),
      message: "is classified as a declaration and holds code that runs",
      fix: `keep only types here, or give the file the kind its code needs in ${TEST_MAP_PATH} (a helper is "unit")`,
    },
  ];
}

const isTestFile = (path: string): boolean => !PARENT_SEGMENT.test(path) && !path.startsWith("/") && (isTestPath(path) || E2E_SPEC.test(path));

export function coveredByProblems(repo: Repo, entry: MapEntry): Problem[] {
  const named = entry.test ?? "";
  const fix = `point \`test\` in ${TEST_MAP_PATH} at a unit test or an e2e spec in this repo that exists and asserts`;
  if (!isTestFile(named)) return [{ message: `its covered-by entry names ${named}, which is not a test file in this repo`, fix }];
  const test = repo.source(named);
  if (!test) return [{ message: `its covered-by entry names ${named}, which does not exist`, fix, related: [named] }];
  return asserts(test) ? [] : [{ message: `its covered-by entry names ${named}, which asserts nothing`, fix, related: [named] }];
}

export function specHelperProblems(repo: Repo, path: string): Problem[] {
  const specs = repo.files(E2E_DIR).filter((spec) => E2E_SPEC.test(spec));
  const used = specs.some((spec) => {
    const source = repo.source(spec);
    return source !== undefined && importsFile(source, path);
  });
  if (used) return [];
  return [
    {
      message: `no spec under ${E2E_DIR}/ imports it`,
      fix: `import it from the spec that needs it, or delete it; a helper under ${E2E_DIR}/ is proven by the specs that run through it`,
      related: specs,
    },
  ];
}

export function testSupportProblems(repo: Repo, path: string): Problem[] {
  const source = repo.source(path);
  const borrowed = source ? importedModules(source).find((module) => isTestPath(`${module}.ts`)) : undefined;
  if (!source || borrowed === undefined) return [];
  return [
    {
      message: `imports ${borrowed}, which is test support; no rule checks code under a test path`,
      fix: "move what this file needs out of the test folder into a source file, which then takes its own kind and proof",
    },
  ];
}
