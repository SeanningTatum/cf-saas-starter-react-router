import ts from "typescript";
import type { Source } from "./types";

export interface Comment {
  pos: number;
  line: number;
  text: string;
  body: string;
}

const LINE_OPEN = /^\/\/\/?/;
const BLOCK_DELIMITER_LENGTH = 2;
const EXTRA_STARS = /^\*+|\*+$/g;

export const commentBody = (text: string): string =>
  (text.startsWith("//")
    ? text.replace(LINE_OPEN, "")
    : text.slice(BLOCK_DELIMITER_LENGTH, -BLOCK_DELIMITER_LENGTH).replace(EXTRA_STARS, "")
  ).trim();

const isJsxContainer = (node: ts.Node | undefined): boolean =>
  node !== undefined && (ts.isJsxElement(node) || ts.isJsxFragment(node));

function textCanFollow(token: ts.Node): boolean {
  const parent = token.parent;
  if (token.kind === ts.SyntaxKind.CloseBraceToken) return ts.isJsxExpression(parent) && isJsxContainer(parent.parent);
  if (token.kind !== ts.SyntaxKind.GreaterThanToken) return false;
  if (ts.isJsxOpeningElement(parent)) return token.end === parent.end;
  if (ts.isJsxOpeningFragment(parent)) return true;
  if (ts.isJsxSelfClosingElement(parent)) return token.end === parent.end && isJsxContainer(parent.parent);
  if (ts.isJsxClosingElement(parent) || ts.isJsxClosingFragment(parent)) return isJsxContainer(parent.parent.parent);
  return false;
}

function forEachToken(root: ts.Node, ast: ts.SourceFile, visit: (token: ts.Node) => void): void {
  const queue: ts.Node[] = [root];
  for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) continue;
    if (node.kind < ts.SyntaxKind.FirstNode) {
      visit(node);
      continue;
    }
    const children = node.getChildren(ast);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) queue.push(child);
    }
  }
}

export function commentsIn(source: Source): Comment[] {
  const { ast, text } = source;
  const found = new Map<number, Comment>();
  const collect = (pos: number, end: number): void => {
    const raw = text.slice(pos, end);
    found.set(pos, { pos, line: ast.getLineAndCharacterOfPosition(pos).line + 1, text: raw, body: commentBody(raw) });
  };
  forEachToken(ast, ast, (token) => {
    if (token.kind !== ts.SyntaxKind.JsxText) {
      const start = token.pos === 0 ? (ts.getShebang(text) ?? "").length : token.pos;
      ts.forEachLeadingCommentRange(text, start, collect);
    }
    if (!textCanFollow(token)) ts.forEachTrailingCommentRange(text, token.end, collect);
  });
  return [...found.values()].sort((a, b) => a.pos - b.pos);
}
