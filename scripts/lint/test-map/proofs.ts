import ts from "typescript";
import {
  E2E_DIR,
  E2E_SPEC,
  LEVELS_FILE,
  LEVELS_NAME,
  MIN_TEST_FILE_CHARS,
  ROUTES_FILE,
  SANDBOX_DIR,
  SANDBOX_ISSUE,
  SMOKE_TAGS,
  TEST_MAP_PATH,
} from "../constants";
import { isSourcePath, lineOf, walkNodes } from "../source";
import type { Repo, Source } from "../types";
import { importedModules, importsFile } from "./imports";
import type { MapEntry } from "./map";
import { routePaths } from "./routes";

export interface Problem {
  line?: number;
  message: string;
  fix: string;
  example?: string;
}

const SOURCE_EXTENSION = /\.tsx?$/;
const DECLARATION_FILE = /\.d\.ts$/;
const MACHINE_SUFFIX = /\.machine\.ts$/;
const PROCEDURE_BUILDER = /Procedure$/;
const ROUTER_FACTORY = "createTRPCRouter";
const ASSERT_CALLEES = new Set(["expect", "assert"]);
const TEST_EXTENSIONS = ["ts", "tsx"];
const UNIT_TEST_EXAMPLE = "app/lib/__tests__/date-utils.test.ts";

const splitPath = (path: string): { dir: string; name: string } => {
  const slash = path.lastIndexOf("/");
  return { dir: path.slice(0, slash), name: path.slice(slash + 1).replace(SOURCE_EXTENSION, "") };
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

function isAssertion(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return ASSERT_CALLEES.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ASSERT_CALLEES.has(callee.expression.text);
}

function asserts(test: Source): boolean {
  let found = false;
  walkNodes(test.ast, (node) => {
    found ||= isAssertion(node);
  });
  return found;
}

function emptyTest(test: Source): Problem | undefined {
  if (test.text.trim().length < MIN_TEST_FILE_CHARS) {
    return { message: `its test ${test.path} is close to empty`, fix: "write a test there that asserts on what the file does" };
  }
  if (!asserts(test)) {
    return {
      message: `its test ${test.path} has no \`expect()\` or \`assert()\` call outside a comment`,
      fix: "assert on what the file returns or does",
    };
  }
  return undefined;
}

function unitProblems(repo: Repo, path: string): Problem[] {
  const source = repo.source(path);
  const runtime = source && firstRuntimeStatement(source.ast);
  if (!source || !runtime) return [];
  const { dir, name } = splitPath(path);
  const candidates = TEST_EXTENSIONS.map((extension) => `${dir}/__tests__/${name}.test.${extension}`);
  const test = candidates.map((candidate) => repo.source(candidate)).find((found) => found !== undefined);
  const expected = candidates[0];
  if (!test) {
    return [
      {
        line: lineOf(source.ast, runtime),
        message: `has no unit test at ${expected}`,
        fix: `add ${expected}; it imports this file and asserts on what it returns`,
        example: UNIT_TEST_EXAMPLE,
      },
    ];
  }
  const empty = emptyTest(test);
  if (empty) return [empty];
  if (importsFile(test, path)) return [];
  return [{ message: `its test ${test.path} never imports it`, fix: `import this file in ${test.path} and assert on what it exports` }];
}

function machineProblems(repo: Repo, path: string): Problem[] {
  const base = path.replace(MACHINE_SUFFIX, "");
  const spec = `${E2E_DIR}/${splitPath(base).name}.paths.spec.ts`;
  const found = repo.source(spec);
  const model = `${base}.`;
  const wired = found !== undefined && importedModules(found).some((module) => module.startsWith(model));
  const specProblems = wired
    ? []
    : [
        {
          message: found ? `its paths spec ${spec} imports neither the machine nor its model` : `has no paths spec at ${spec}`,
          fix: `add ${spec}: replay the machine's generated paths in the browser, one per DOM binding and per state's view`,
        },
      ];
  return [...unitProblems(repo, path), ...specProblems];
}

function procedureNames(source: Source): string[] {
  const names: string[] = [];
  walkNodes(source.ast, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === ROUTER_FACTORY) {
      const [routes] = node.arguments;
      if (routes && ts.isObjectLiteralExpression(routes)) {
        for (const property of routes.properties) {
          if (property.name && ts.isIdentifier(property.name)) names.push(property.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const start = node.initializer.getText(source.ast).split(/[.(]/)[0] ?? "";
      if (PROCEDURE_BUILDER.test(start)) names.push(node.name.text);
    }
  });
  return [...new Set(names)];
}

function levelKeys(repo: Repo): string[] {
  const levels = repo.source(LEVELS_FILE);
  const keys: string[] = [];
  if (!levels) return keys;
  walkNodes(levels.ast, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== LEVELS_NAME) return;
    if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) return;
    for (const property of node.initializer.properties) {
      if (property.name && (ts.isStringLiteralLike(property.name) || ts.isIdentifier(property.name))) keys.push(property.name.text);
    }
  });
  return keys;
}

function mentions(test: Source, names: string[]): boolean {
  let found = false;
  walkNodes(test.ast, (node) => {
    if (ts.isIdentifier(node)) found ||= names.includes(node.text);
    if (ts.isStringLiteralLike(node)) found ||= names.some((name) => node.text.split(".").includes(name));
  });
  return found;
}

function procedureProblems(repo: Repo, path: string): Problem[] {
  const source = repo.source(path);
  if (!source) return [];
  const names = procedureNames(source);
  const keys = levelKeys(repo);
  const unlisted = names
    .filter((name) => !keys.some((key) => key.split(".").pop() === name))
    .map((name) => ({
      message: `the procedure \`${name}\` has no entry in \`${LEVELS_NAME}\` in ${LEVELS_FILE}`,
      fix: `add \`"<router>.${name}": "protected"\` or \`"admin"\` to \`${LEVELS_NAME}\` (and to \`OWNERSHIP\` when it is "protected")`,
    }));
  const { dir, name } = splitPath(path);
  const expected = `${dir}/__tests__/${name}.test.ts`;
  const test = repo.source(expected);
  const fix = `add ${expected}: call each procedure through \`createCallerFactory(appRouter)\` and assert on the result and on each tagged error`;
  if (!test) return [...unlisted, { message: `has no procedure test at ${expected}`, fix }];
  const empty = emptyTest(test);
  if (empty) return [...unlisted, empty];
  return mentions(test, names) ? unlisted : [...unlisted, { message: `its test ${expected} names none of its procedures`, fix }];
}

interface SpecFacts {
  path: string;
  smoke: boolean;
  visits: string[];
}

function specFacts(repo: Repo): SpecFacts[] {
  return repo
    .files(E2E_DIR)
    .filter((path) => E2E_SPEC.test(path))
    .flatMap((path) => {
      const spec = repo.source(path);
      if (!spec) return [];
      const strings = new Set<string>();
      const visits: string[] = [];
      walkNodes(spec.ast, (node) => {
        if (ts.isStringLiteralLike(node)) strings.add(node.text);
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
        const [target] = node.arguments;
        if (node.expression.name.text === "goto" && target && ts.isStringLiteralLike(target)) visits.push(target.text);
      });
      return [{ path, smoke: SMOKE_TAGS.every((tag) => strings.has(tag)), visits }];
    });
}

const visitsPath = (visited: string, path: string): boolean => visited.split(/[?#]/)[0] === path;

function routeProblems(repo: Repo, path: string): Problem[] {
  const table = repo.source(ROUTES_FILE);
  const paths = (table ? routePaths(table).get(path) : undefined) ?? [];
  if (paths.length === 0) {
    return [{ message: `is classified as a route and ${ROUTES_FILE} does not list it`, fix: `add it to ${ROUTES_FILE}, or give it another kind in ${TEST_MAP_PATH}` }];
  }
  const proven = specFacts(repo).some((spec) => spec.smoke && spec.visits.some((visited) => paths.some((own) => visitsPath(visited, own))));
  if (proven) return [];
  const [first] = paths;
  return [
    {
      message: `no e2e spec with an ${SMOKE_TAGS.join(" and an ")} test visits ${paths.join(" or ")}`,
      fix: `add ${E2E_DIR}/<feature>.spec.ts with \`page.goto("${first}")\`, one test tagged \`{ tag: "@golden" }\` and one \`{ tag: "@error" }\``,
    },
  ];
}

function sandboxProblems(repo: Repo, path: string): Problem[] {
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
        `render it in a file under ${SANDBOX_DIR}/. Until the sandbox exists (${SANDBOX_ISSUE}), a new component names the e2e spec that ` +
        `exercises it instead: add \`{ "match": "${path}", "kind": "covered-by", "test": "e2e/<spec>.spec.ts", "reason": "…" }\` ` +
        `above the broader glob in ${TEST_MAP_PATH}`,
    },
  ];
}

function declarationProblems(repo: Repo, path: string): Problem[] {
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

function coveredByProblems(repo: Repo, entry: MapEntry): Problem[] {
  const named = entry.test ?? "";
  const test = repo.source(named);
  const fix = `point \`test\` in ${TEST_MAP_PATH} at a test file that exists and asserts`;
  if (!test) return [{ message: `its covered-by entry names ${named}, which does not exist`, fix }];
  return asserts(test) ? [] : [{ message: `its covered-by entry names ${named}, which asserts nothing`, fix }];
}

export function proofProblems(repo: Repo, path: string, entry: MapEntry): Problem[] {
  switch (entry.kind) {
    case "unit":
      return unitProblems(repo, path);
    case "machine":
      return machineProblems(repo, path);
    case "procedure":
      return procedureProblems(repo, path);
    case "route":
      return routeProblems(repo, path);
    case "component":
    case "primitive":
      return sandboxProblems(repo, path);
    case "declaration":
      return declarationProblems(repo, path);
    case "covered-by":
      return coveredByProblems(repo, entry);
  }
}
