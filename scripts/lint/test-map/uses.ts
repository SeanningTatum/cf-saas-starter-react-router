import ts from "typescript";
import { walkNodes } from "../source";
import type { Source } from "../types";
import { moduleNames, resolveSpecifier } from "./imports";

const EXPECT_CALLEE = "expect";
const ASSERT_CALLEE = "assert";
const PRESENCE_MATCHERS = new Set(["toBeDefined", "toBeUndefined", "toBeTruthy", "toBeFalsy", "toBeNull", "toBeTypeOf", "toBeInstanceOf"]);
const ASSERT_PRESENCE_METHODS = new Set([
  "ok",
  "isOk",
  "exists",
  "notExists",
  "isDefined",
  "isUndefined",
  "isNull",
  "isNotNull",
  "isFunction",
  "typeOf",
  "instanceOf",
]);
const MOCK_CALLS = new Set(["mock", "doMock"]);
const MOCK_OWNER = "vi";
const REAL_MODULE_READERS = new Set(["importOriginal", "importActual"]);

const resolvesTo = (argument: ts.Expression | undefined, source: Source, names: string[]): boolean => {
  if (!argument || !ts.isStringLiteralLike(argument)) return false;
  const resolved = resolveSpecifier(argument.text, source.path);
  return resolved !== undefined && names.includes(resolved);
};

function valueBindings(clause: ts.ImportClause | undefined): string[] {
  if (!clause || clause.isTypeOnly) return [];
  const bindings = clause.namedBindings;
  const named = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text) : [];
  const namespace = bindings && ts.isNamespaceImport(bindings) ? [bindings.name.text] : [];
  return [...(clause.name ? [clause.name.text] : []), ...named, ...namespace];
}

function isNameSlot(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    ts.isPropertyAccessExpression(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isClassDeclaration(parent)
  ) {
    return parent.name === node;
  }
  if (ts.isBindingElement(parent)) return parent.propertyName === node || parent.name === node;
  return ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent);
}

function inTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isTypeNode(current) && !ts.isExpressionWithTypeArguments(current)) return true;
  }
  return false;
}

function calleeName(call: ts.CallExpression): string | undefined {
  let callee: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) ? callee.text : undefined;
}

function matcherOf(expectCall: ts.CallExpression): string | undefined {
  let current: ts.Node = expectCall;
  while (ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current) current = current.parent;
  return ts.isPropertyAccessExpression(current) && ts.isCallExpression(current.parent) && current.parent.expression === current ? current.name.text : undefined;
}

function chainTop(node: ts.Expression): { top: ts.Expression; read: boolean } {
  let top: ts.Expression = node;
  let read = false;
  for (;;) {
    const parent = top.parent;
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === top) {
      read = true;
      top = parent;
    } else if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent) || ts.isSatisfiesExpression(parent)) {
      top = parent;
    } else {
      return { top, read };
    }
  }
}

function invokes(parent: ts.Node, top: ts.Expression): boolean {
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === top) return true;
  if (ts.isTaggedTemplateExpression(parent)) return parent.tag === top;
  return (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) && parent.tagName === top;
}

function passedOn(call: ts.CallExpression, read: boolean): boolean {
  const callee = calleeName(call);
  if (read || (callee !== EXPECT_CALLEE && callee !== ASSERT_CALLEE)) return true;
  if (callee === EXPECT_CALLEE) return !PRESENCE_MATCHERS.has(matcherOf(call) ?? "");
  return ts.isPropertyAccessExpression(call.expression) && !ASSERT_PRESENCE_METHODS.has(call.expression.name.text);
}

const isHandedOver = (parent: ts.Node, top: ts.Expression): boolean =>
  ts.isShorthandPropertyAssignment(parent) ||
  ts.isJsxExpression(parent) ||
  ts.isArrayLiteralExpression(parent) ||
  ts.isSpreadElement(parent) ||
  (ts.isPropertyAssignment(parent) && parent.initializer === top);

function exercises(node: ts.Identifier): boolean {
  const { top, read } = chainTop(node);
  const parent = top.parent;
  if (invokes(parent, top)) return true;
  if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === top)) return passedOn(parent, read);
  return isHandedOver(parent, top) || read;
}

function isRealModuleRead(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
  return name !== undefined && REAL_MODULE_READERS.has(name);
}

const unwrapAwait = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
};

function keepsRealModule(factory: ts.Node): boolean {
  const holders = new Set<string>();
  walkNodes(factory, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isRealModuleRead(unwrapAwait(node.initializer))) {
      holders.add(node.name.text);
    }
  });
  let kept = false;
  walkNodes(factory, (node) => {
    if (!ts.isSpreadAssignment(node)) return;
    const spread = unwrapAwait(node.expression);
    kept ||= isRealModuleRead(spread) || (ts.isIdentifier(spread) && holders.has(spread.text));
  });
  return kept;
}

function isMocked(source: Source, names: string[]): boolean {
  let mocked = false;
  walkNodes(source.ast, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const { expression: owner, name } = node.expression;
    if (!ts.isIdentifier(owner) || owner.text !== MOCK_OWNER || !MOCK_CALLS.has(name.text) || !resolvesTo(node.arguments[0], source, names)) return;
    const factory = node.arguments[1];
    mocked ||= factory === undefined || !keepsRealModule(factory);
  });
  return mocked;
}

function usedDynamicImport(source: Source, names: string[]): boolean {
  let found = false;
  walkNodes(source.ast, (node) => {
    if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword || !resolvesTo(node.arguments[0], source, names)) return;
    const holder = ts.isAwaitExpression(node.parent) ? node.parent.parent : node.parent;
    found ||= !ts.isExpressionStatement(holder);
  });
  return found;
}

export function usesFile(source: Source, target: string): boolean {
  const names = moduleNames(target);
  if (isMocked(source, names)) return false;
  if (usedDynamicImport(source, names)) return true;
  const locals = new Set(
    source.ast.statements.flatMap((statement) =>
      ts.isImportDeclaration(statement) && resolvesTo(statement.moduleSpecifier, source, names) ? valueBindings(statement.importClause) : [],
    ),
  );
  if (locals.size === 0) return false;
  let used = false;
  walkNodes(source.ast, (node) => {
    used ||= ts.isIdentifier(node) && locals.has(node.text) && !isNameSlot(node) && !inTypePosition(node) && exercises(node);
  });
  return used;
}
