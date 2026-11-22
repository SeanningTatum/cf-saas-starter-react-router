import { posix } from "node:path";
import ts from "typescript";
import { APP_ALIAS, APP_DIR } from "../constants";
import { walkNodes } from "../source";
import type { Source } from "../types";

const CODE_EXTENSION = /\.(tsx?|jsx?)$/;
const INDEX_MODULE = /\/index$/;
const TRAILING_SLASH = /\/$/;

export const withoutExtension = (path: string): string => path.replace(CODE_EXTENSION, "");

function resolveSpecifier(specifier: string, from: string): string | undefined {
  if (specifier.startsWith(APP_ALIAS)) return withoutExtension(`${APP_DIR}${specifier.slice(APP_ALIAS.length)}`);
  if (!specifier.startsWith(".")) return undefined;
  return withoutExtension(posix.normalize(posix.join(posix.dirname(from), specifier)).replace(TRAILING_SLASH, ""));
}

function specifierOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return undefined;
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

export function importsFile(source: Source, target: string): boolean {
  const module = withoutExtension(target);
  const names = INDEX_MODULE.test(module) ? [module, module.replace(INDEX_MODULE, "")] : [module];
  return importedModules(source).some((imported) => names.includes(imported));
}
