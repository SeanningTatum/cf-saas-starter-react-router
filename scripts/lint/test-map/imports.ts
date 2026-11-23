import { posix } from "node:path";
import ts from "typescript";
import { APP_ALIAS, APP_DIR } from "../constants";
import { walkNodes } from "../source";
import type { Source } from "../types";

const CODE_EXTENSION = /\.(tsx?|jsx?)$/;
const INDEX_MODULE = /\/index$/;
const TRAILING_SLASH = /\/$/;

export const withoutExtension = (path: string): string => path.replace(CODE_EXTENSION, "");

export function resolveSpecifier(specifier: string, from: string): string | undefined {
  if (specifier.startsWith(APP_ALIAS)) return withoutExtension(`${APP_DIR}${specifier.slice(APP_ALIAS.length)}`);
  if (!specifier.startsWith(".")) return undefined;
  return withoutExtension(posix.normalize(posix.join(posix.dirname(from), specifier)).replace(TRAILING_SLASH, ""));
}

function isTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (clause.name || !bindings || !ts.isNamedImports(bindings) || bindings.elements.length === 0) return false;
  return bindings.elements.every((element) => element.isTypeOnly);
}

function specifierOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && isTypeOnlyImport(node.importClause)) return undefined;
  if (ts.isExportDeclaration(node) && node.isTypeOnly) return undefined;
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return undefined;
  const first = node.arguments[0];
  return first && ts.isStringLiteralLike(first) ? first.text : undefined;
}

export function importedModules(source: Source): string[] {
  const modules: string[] = [];
  walkNodes(source.ast, (node) => {
    const specifier = specifierOf(node);
    const resolved = specifier === undefined ? undefined : resolveSpecifier(specifier, source.path);
    if (resolved !== undefined) modules.push(resolved);
  });
  return modules;
}

const moduleNames = (target: string): string[] => {
  const module = withoutExtension(target);
  return INDEX_MODULE.test(module) ? [module, module.replace(INDEX_MODULE, "")] : [module];
};

export function importsFile(source: Source, target: string): boolean {
  const names = moduleNames(target);
  return importedModules(source).some((imported) => names.includes(imported));
}

function valueBindings(clause: ts.ImportClause | undefined): string[] {
  if (!clause || clause.isTypeOnly) return [];
  const bindings = clause.namedBindings;
  const named = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text) : [];
  const namespace = bindings && ts.isNamespaceImport(bindings) ? [bindings.name.text] : [];
  return [...(clause.name ? [clause.name.text] : []), ...named, ...namespace];
}

function isNameSlot(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name === node;
  }
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  return ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent);
}

function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isTypeNode(current) && !ts.isExpressionWithTypeArguments(current)) return true;
  }
  return false;
}

function dynamicallyImports(source: Source, names: string[]): boolean {
  let found = false;
  walkNodes(source.ast, (node) => {
    if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
    const specifier = specifierOf(node);
    const resolved = specifier === undefined ? undefined : resolveSpecifier(specifier, source.path);
    found ||= resolved !== undefined && names.includes(resolved);
  });
  return found;
}

export function usesFile(source: Source, target: string): boolean {
  const names = moduleNames(target);
  if (dynamicallyImports(source, names)) return true;
  const locals = new Set(
    source.ast.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) return [];
      const resolved = resolveSpecifier(statement.moduleSpecifier.text, source.path);
      return resolved !== undefined && names.includes(resolved) ? valueBindings(statement.importClause) : [];
    }),
  );
  if (locals.size === 0) return false;
  let used = false;
  walkNodes(source.ast, (node) => {
    used ||= ts.isIdentifier(node) && locals.has(node.text) && !isNameSlot(node) && !inTypePosition(node);
  });
  return used;
}
