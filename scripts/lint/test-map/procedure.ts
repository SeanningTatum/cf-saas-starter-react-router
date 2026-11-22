import ts from "typescript";
import { LEVELS_FILE, LEVELS_NAME, ROUTER_FILE } from "../constants";
import { walkNodes } from "../source";
import type { Repo, Source } from "../types";
import { importedModules, resolveSpecifier, withoutExtension } from "./imports";
import { emptyTest, splitPath, type Problem } from "./proofs";

const PROCEDURE_BUILDER = /Procedure$/;
const ROUTER_FACTORY = "createTRPCRouter";

function routerObjects(source: Source): ts.ObjectLiteralExpression[] {
  const objects: ts.ObjectLiteralExpression[] = [];
  walkNodes(source.ast, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== ROUTER_FACTORY) return;
    const [routes] = node.arguments;
    if (routes && ts.isObjectLiteralExpression(routes)) objects.push(routes);
  });
  return objects;
}

const propertyNames = (object: ts.ObjectLiteralExpression): string[] =>
  object.properties.flatMap((property) => (property.name && ts.isIdentifier(property.name) ? [property.name.text] : []));

function builderName(initializer: ts.Expression): string | undefined {
  let current = initializer;
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

function standaloneProcedures(source: Source): string[] {
  return source.ast.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.flatMap((declaration) => {
          const builder = declaration.initializer ? builderName(declaration.initializer) : undefined;
          return ts.isIdentifier(declaration.name) && builder && PROCEDURE_BUILDER.test(builder) ? [declaration.name.text] : [];
        })
      : []
  );
}

export function procedureNames(source: Source): { routed: string[]; standalone: string[] } {
  return { routed: [...new Set(routerObjects(source).flatMap(propertyNames))], standalone: standaloneProcedures(source) };
}

function importedNames(source: Source): Map<string, string> {
  const modules = new Map<string, string>();
  for (const statement of source.ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const module = resolveSpecifier(statement.moduleSpecifier.text, source.path);
    if (module === undefined) continue;
    for (const element of bindings.elements) modules.set(element.name.text, module);
  }
  return modules;
}

export function routerKey(repo: Repo, path: string): string | undefined {
  const router = repo.source(ROUTER_FILE);
  if (!router) return undefined;
  const modules = importedNames(router);
  const target = withoutExtension(path);
  for (const object of routerObjects(router)) {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !ts.isIdentifier(property.initializer)) continue;
      if (modules.get(property.initializer.text) === target) return property.name.text;
    }
  }
  return undefined;
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

function calls(test: Source, names: string[]): boolean {
  let found = false;
  walkNodes(test.ast, (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) found ||= names.includes(node.expression.name.text);
  });
  return found;
}

const levelsFix = (key: string): string =>
  `add \`"${key}": "protected"\` or \`"admin"\` to \`${LEVELS_NAME}\` in ${LEVELS_FILE} (and to \`OWNERSHIP\` when it is "protected")`;

export function procedureProblems(repo: Repo, path: string): Problem[] {
  const source = repo.source(path);
  if (!source) return [];
  const { routed, standalone } = procedureNames(source);
  const keys = levelKeys(repo);
  const router = routerKey(repo, path);
  const unlistedRouted = routed
    .filter((name) => (router ? !keys.includes(`${router}.${name}`) : !keys.some((key) => key.split(".").pop() === name)))
    .map((name) => ({ message: `the procedure \`${name}\` has no entry in \`${LEVELS_NAME}\``, fix: levelsFix(`${router ?? "<router>"}.${name}`) }));
  const unlistedStandalone = standalone
    .filter((name) => !keys.some((key) => key.split(".").pop() === name))
    .map((name) => ({ message: `the procedure \`${name}\` has no entry in \`${LEVELS_NAME}\``, fix: levelsFix(`<router>.${name}`) }));
  const unlisted = [...unlistedRouted, ...unlistedStandalone];

  const { dir, name } = splitPath(path);
  const expected = `${dir}/__tests__/${name}.test.ts`;
  const test = repo.source(expected);
  const fix = `add ${expected}: call each procedure through \`createCallerFactory(appRouter)\` and assert on the result and on each tagged error`;
  if (!test) return [...unlisted, { message: `has no procedure test at ${expected}`, fix }];
  const empty = emptyTest(test);
  if (empty) return [...unlisted, empty];
  const modules = importedModules(test);
  const reaches = modules.includes(withoutExtension(ROUTER_FILE)) || modules.includes(withoutExtension(path));
  if (reaches && calls(test, [...routed, ...standalone])) return unlisted;
  return [
    ...unlisted,
    { file: test.path, message: `this test does not call a procedure of ${path} through the router`, fix: `import \`appRouter\` from ${ROUTER_FILE} here, call a procedure of ${path} and assert on the result` },
  ];
}
