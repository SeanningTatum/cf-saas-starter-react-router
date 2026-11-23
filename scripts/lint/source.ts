import ts from "typescript";
import { SHIPPED_ROOTS, SIZED_ROOTS, SOURCE_FILE, TEST_PATH, VENDORED_UI } from "./constants";

export const isSourcePath = (path: string): boolean => SOURCE_FILE.test(path);

export const isTestPath = (path: string): boolean => TEST_PATH.test(path);

export const isShippedSource = (path: string): boolean => isSourcePath(path) && !isTestPath(path) && SHIPPED_ROOTS.some((root) => path.startsWith(`${root}/`));

export const isOwnShippedSource = (path: string): boolean => isShippedSource(path) && !path.startsWith(VENDORED_UI);

export const isSizedSource = (path: string): boolean =>
  isSourcePath(path) && !path.startsWith(VENDORED_UI) && SIZED_ROOTS.some((root) => path.startsWith(`${root}/`));

export function unwrapExpression(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return unwrapExpression(node.expression);
  return node;
}

export const lineOf = (ast: ts.SourceFile, node: ts.Node): number => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;

export function walkNodes(root: ts.Node, visit: (node: ts.Node) => void): void {
  visit(root);
  root.forEachChild((child) => walkNodes(child, visit));
}
