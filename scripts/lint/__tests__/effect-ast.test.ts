import ts from "typescript";
import { describe, expect, it } from "vitest";
import { effectAliases, insideEffectTry } from "../effect-ast";
import { walkNodes } from "../source";
import { sourceOf } from "./fixtures";

const throwIsExcused = (code: string): boolean => {
  const { ast } = sourceOf(code);
  const throws: ts.Node[] = [];
  walkNodes(ast, (node) => {
    if (ts.isThrowStatement(node)) throws.push(node);
  });
  return throws.length > 0 && throws.every((node) => insideEffectTry(node, ast));
};

describe("insideEffectTry", () => {
  it.each([
    ["Effect.tryMap", "export const a = Effect.tryMap(x, { try: () => { throw new Error('x'); }, catch: (e) => e });", true],
    ["Effect.tryMapPromise", "export const a = Effect.tryMapPromise(x, { try: async () => { throw new Error('x'); }, catch: (e) => e });", true],
    ["Effect.map, which has no error channel for a throw", "export const a = Effect.map(x, () => { throw new Error('x'); });", false],
  ])("a throw inside %s: excused %s", (_name, code, excused) => {
    expect(throwIsExcused(code)).toBe(excused);
  });
});

describe("effectAliases", () => {
  it("adds names bound to the Effect module and no name bound to another module or another export of effect", () => {
    const { ast } = sourceOf(
      [
        'import * as E from "effect/Effect";',
        'import { Effect as Eff, Schema as S } from "effect";',
        'import * as Q from "some-queue";',
        'import { Effect as NotIt } from "not-effect";',
      ].join("\n"),
    );

    expect([...effectAliases(ast)].sort()).toEqual(["E", "Eff", "Effect"]);
  });
});
