import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isLiteralValue, literalConstants } from "../literals";
import { sourceOf } from "./fixtures";

const initializersOf = (code: string): ts.Expression[] =>
  sourceOf(`const value = ${code};\n`).ast.statements.flatMap((statement) =>
    ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap((declaration) => declaration.initializer ?? []) : [],
  );

const literal = (code: string): boolean[] => initializersOf(code).map(isLiteralValue);

const constantNames = (code: string, frameworkExports: ReadonlySet<string> = new Set()): string[] => {
  const { ast } = sourceOf(code);
  return literalConstants(ast, frameworkExports).map((declaration) => declaration.name.getText(ast));
};

describe("isLiteralValue", () => {
  it.each([
    ["a number", "42"],
    ["a negative number", "-1"],
    ["a plus-signed number", "+1"],
    ["a bigint", "10n"],
    ["a string", '"text"'],
    ["a template with no substitution", "`text`"],
    ["a regex", "/^[a-z-]+$/"],
    ["arithmetic on literals", "10 * 1024 * 1024"],
    ["a power and a remainder", "2 ** 10 % 7"],
    ["a sign on parenthesised arithmetic", "-(1 + 2)"],
    ["an array of literals", '["a", "b"]'],
    ["an object of literals with plain and quoted keys", '{ a: 1, "b-c": "x" }'],
    ["nested arrays and objects", '{ a: [1, [2, 3]], b: { c: /x/, d: ["e"] } }'],
    ["an `as const` wrapper", '["a", "b"] as const'],
    ["a `satisfies` wrapper", "{ a: 1 } satisfies Record<string, number>"],
    ["parentheses", "(1 + 2)"],
    ["a Set of literals", 'new Set(["a", "b"])'],
    ["a Map of literals", 'new Map([["a", 1], ["b", 2]])'],
  ])("is true for %s: %s", (_kind, code) => {
    expect(literal(code)).toEqual([true]);
  });

  it.each([
    ["a call", "make()"],
    ["an identifier", "other"],
    ["undefined, which is an identifier", "undefined"],
    ["a template with a substitution", "`${base}/api`"],
    ["an empty array", "[]"],
    ["an empty object", "{}"],
    ["an array holding a function", "[() => 1]"],
    ["an object holding a function", "{ run: () => 1 }"],
    ["an object holding a method", "{ run() { return 1; } }"],
    ["an array holding an identifier", "[1, other]"],
    ["an object holding an identifier", "{ a: 1, b: other }"],
    ["an identifier deep inside nested arrays", "[[1, [other]]]"],
    ["an array spread", "[...items]"],
    ["an object spread", "{ ...rest }"],
    ["an object with a computed key", "{ [key]: 1 }"],
    ["an object with a shorthand property", "{ other }"],
    ["arithmetic with an identifier", "1 + other"],
    ["a negated identifier", "-other"],
    ["a logical not, which is not a sign", "!1"],
    ["a comparison, which is not arithmetic", "1 < 2"],
    ["a Set with no argument", "new Set()"],
    ["a Set of an empty array", "new Set([])"],
    ["a Set of an identifier", "new Set(items)"],
    ["a Map holding an identifier", 'new Map([["a", other]])'],
    ["a Set reached through a property", "new globalThis.Set([1])"],
    ["a Date", 'new Date("2026-01-01")'],
    ["a boolean, which the ticket leaves out", "true"],
    ["null, which the ticket leaves out", "null"],
  ])("is false for %s: %s", (_kind, code) => {
    expect(literal(code)).toEqual([false]);
  });
});

describe("literalConstants", () => {
  it("finds a module-level const only, not a let, a var, or a const inside a function or a block", () => {
    const code = [
      "const A = 1;",
      "let B = 2;",
      "var C = 3;",
      "function f() { const D = 4; return D; }",
      "{ const E = 5; }",
      "if (A) { const F = 6; }",
      'export const G = "g";',
      "const H = make();",
      "declare const I: number;",
    ].join("\n");

    expect(constantNames(code)).toEqual(["A", "G"]);
  });

  it("returns each literal declaration of a multi-declaration statement on its own", () => {
    expect(constantNames('const A = 1, B = make(), C = "c";\n')).toEqual(["A", "C"]);
  });

  it("skips an exported framework name, and returns the same name when it is not exported", () => {
    const handle = new Set(["handle"]);

    expect(constantNames('export const handle = { i18n: ["home"] };\n', handle)).toEqual([]);
    expect(constantNames('const handle = { i18n: ["home"] };\nexport const f = () => handle;\n', handle)).toEqual(["handle"]);
  });

  it("skips only the framework name in an exported statement, not its siblings or other exports", () => {
    const handle = new Set(["handle"]);

    expect(constantNames('export const handle = { a: 1 }, extra = 2;\nexport const other = "x";\n', handle)).toEqual(["extra", "other"]);
  });
});
