import ts from "typescript";
import { describe, expect, it } from "vitest";
import { walkNodes } from "../source";
import { calleeName, callsAny, contains, localsThatReach } from "../span-ast";
import { sourceOf } from "./fixtures";

const firstCall = (code: string): ts.CallExpression => {
  const { ast } = sourceOf(code);
  const calls: ts.CallExpression[] = [];
  walkNodes(ast, (node) => {
    if (ts.isCallExpression(node)) calls.push(node);
  });
  const [call] = calls;
  if (!call) return ts.factory.createCallExpression(ts.factory.createIdentifier("none"), undefined, []);
  return call;
};

describe("calleeName", () => {
  it("reads a bare name and the last name of a member call, and nothing from a computed call", () => {
    expect(calleeName(firstCall("run(1);"))).toBe("run");
    expect(calleeName(firstCall("Effect.withSpan('x');"))).toBe("withSpan");
    expect(calleeName(firstCall("table['run'](1);"))).toBeUndefined();
  });
});

describe("localsThatReach", () => {
  it("follows a chain of local helpers to the target, so a span made two helpers away still counts", () => {
    const { ast } = sourceOf(
      [
        'const span = (n: string) => Effect.withSpan(n, { kind: "client" });',
        "const r2 = (n: string) => span(`r2.${n}`);",
        "function unrelated() { return 1; }",
      ].join("\n"),
    );

    expect([...localsThatReach(ast, "withSpan")].sort()).toEqual(["r2", "span", "withSpan"]);
  });

  it("leaves out a helper that only names the target in a string, so text cannot stand in for a call", () => {
    const { ast } = sourceOf('const fake = () => "Effect.withSpan";');

    expect([...localsThatReach(ast, "withSpan")]).toEqual(["withSpan"]);
  });
});

describe("contains and callsAny", () => {
  it("find a call nested inside a callback, so a handler that returns the call from a closure is seen", () => {
    const { ast } = sourceOf("export const h = () => [1].map(() => runProcedure(rt, e, { span }));");

    expect(callsAny(ast, new Set(["runProcedure"]))).toBe(true);
    expect(callsAny(ast, new Set(["other"]))).toBe(false);
    expect(contains(ast, (node) => ts.isArrowFunction(node))).toBe(true);
  });
});
