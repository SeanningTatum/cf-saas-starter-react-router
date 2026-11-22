import type ts from "typescript";
import { SHIPPED_ROOTS, SOURCE_FILE, TEST_PATH, VENDORED_UI } from "./constants";

export const isSourcePath = (path: string): boolean => SOURCE_FILE.test(path);

export const isTestPath = (path: string): boolean => TEST_PATH.test(path);

export const isShippedSource = (path: string): boolean =>
  isSourcePath(path) && !isTestPath(path) && SHIPPED_ROOTS.some((root) => path.startsWith(`${root}/`));

export const isOwnShippedSource = (path: string): boolean => isShippedSource(path) && !path.startsWith(VENDORED_UI);

export const lineOf = (ast: ts.SourceFile, node: ts.Node): number =>
  ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;

export function walkNodes(root: ts.Node, visit: (node: ts.Node) => void): void {
  visit(root);
  root.forEachChild((child) => walkNodes(child, visit));
}
