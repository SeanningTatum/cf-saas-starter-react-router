import ts from "typescript";
import type { Source } from "./types";

export interface Comment {
  pos: number;
  line: number;
  endLine: number;
  text: string;
  body: string;
}

const LINE_OPEN = /^\/\/\/?/;
const BLOCK_DELIMITER_LENGTH = 2;
const EXTRA_STARS = /^\*+|\*+$/g;

export const commentBody = (text: string): string =>
  (text.startsWith("//") ? text.replace(LINE_OPEN, "") : text.slice(BLOCK_DELIMITER_LENGTH, -BLOCK_DELIMITER_LENGTH).replace(EXTRA_STARS, "")).trim();

const isJsxContainer = (node: ts.Node | undefined): boolean => node !== undefined && (ts.isJsxElement(node) || ts.isJsxFragment(node));

function jsxTextFollows(token: ts.Node): boolean {
  const parent = token.parent;
  if (token.kind === ts.SyntaxKind.CloseBraceToken) return ts.isJsxExpression(parent) && isJsxContainer(parent.parent);
  if (token.kind !== ts.SyntaxKind.GreaterThanToken) return false;
  if (ts.isJsxOpeningElement(parent)) return token.end === parent.end;
  if (ts.isJsxOpeningFragment(parent)) return true;
  if (ts.isJsxSelfClosingElement(parent)) return token.end === parent.end && isJsxContainer(parent.parent);
  if (ts.isJsxClosingElement(parent) || ts.isJsxClosingFragment(parent)) return isJsxContainer(parent.parent.parent);
  return false;
}

const isJsDocNode = (node: ts.Node): boolean => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

function forEachToken(node: ts.Node, ast: ts.SourceFile, visit: (token: ts.Node) => void): void {
  if (isJsDocNode(node)) return;
  if (node.kind < ts.SyntaxKind.FirstNode) {
    visit(node);
    return;
  }
  for (const child of node.getChildren(ast)) forEachToken(child, ast, visit);
}

export function commentsIn(source: Source): Comment[] {
  const { ast, text } = source;
  const seen = new Set<number>();
  const comments: Comment[] = [];
  const lineAt = (pos: number): number => ast.getLineAndCharacterOfPosition(pos).line + 1;
  const collect = (pos: number, end: number): void => {
    if (seen.has(pos)) return;
    seen.add(pos);
    const raw = text.slice(pos, end);
    comments.push({ pos, line: lineAt(pos), endLine: lineAt(end), text: raw, body: commentBody(raw) });
  };
  forEachToken(ast, ast, (token) => {
    if (token.kind !== ts.SyntaxKind.JsxText) {
      const start = token.pos === 0 ? (ts.getShebang(text) ?? "").length : token.pos;
      ts.forEachLeadingCommentRange(text, start, collect);
    }
    if (!jsxTextFollows(token)) ts.forEachTrailingCommentRange(text, token.end, collect);
  });
  return comments.sort((a, b) => a.pos - b.pos);
}
