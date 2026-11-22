import ts from "typescript";
import { APP_DIR } from "../constants";
import { unwrapExpression } from "../source";
import type { Source } from "../types";

export const ROOT_PATH = "/";

const joinPath = (base: string, segment: string): string => {
  const joined = `${base}/${segment}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : ROOT_PATH;
};

const literal = (node: ts.Node | undefined): string | undefined =>
  node && ts.isStringLiteralLike(node) ? node.text : undefined;

const children = (call: ts.CallExpression): readonly ts.Expression[] =>
  call.arguments.flatMap((argument) => (ts.isArrayLiteralExpression(argument) ? argument.elements : []));

export function routePaths(source: Source): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  const add = (file: string | undefined, path: string): void => {
    if (file === undefined) return;
    const module = `${APP_DIR}${file}`;
    paths.set(module, [...(paths.get(module) ?? []), path]);
  };
  const visit = (elements: readonly ts.Expression[], base: string): void => {
    for (const element of elements) {
      const call = ts.isSpreadElement(element) ? element.expression : element;
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      const [first, second] = call.arguments;
      const helper = call.expression.text;
      if (helper === "index") add(literal(first), joinPath(base, ""));
      if (helper === "layout") {
        add(literal(first), joinPath(base, ""));
        visit(children(call), base);
      }
      if (helper === "prefix") visit(children(call), joinPath(base, literal(first) ?? ""));
      if (helper === "route") {
        const own = literal(first);
        if (own === undefined) continue;
        const path = joinPath(base, own);
        add(literal(second), path);
        visit(children(call), path);
      }
    }
  };
  for (const statement of source.ast.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    const table = unwrapExpression(statement.expression);
    if (ts.isArrayLiteralExpression(table)) visit(table.elements, "");
  }
  return paths;
}
