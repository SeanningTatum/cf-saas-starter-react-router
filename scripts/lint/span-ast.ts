import ts from "typescript";
import { walkNodes } from "./source";

export const calleeName = (call: ts.CallExpression): string | undefined => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
};

export const contains = (root: ts.Node, test: (node: ts.Node) => boolean): boolean => {
  let found = false;
  walkNodes(root, (node) => {
    if (!found && test(node)) found = true;
  });
  return found;
};

const localFunctions = (ast: ts.SourceFile): Map<string, ts.Node> => {
  const found = new Map<string, ts.Node>();
  walkNodes(ast, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) found.set(node.name.text, node.body);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found.set(node.name.text, node.initializer.body);
    }
  });
  return found;
};

export const callsAny = (root: ts.Node, names: ReadonlySet<string>): boolean =>
  contains(root, (node) => ts.isCallExpression(node) && names.has(calleeName(node) ?? ""));

export const localsThatReach = (ast: ts.SourceFile, target: string): Set<string> => {
  const locals = localFunctions(ast);
  const reaching = new Set<string>([target]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of locals) {
      if (reaching.has(name) || !callsAny(body, reaching)) continue;
      reaching.add(name);
      grew = true;
    }
  }
  return reaching;
};
