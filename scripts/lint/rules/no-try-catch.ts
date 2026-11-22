import ts from "typescript";
import { insideEffectTry } from "../effect-ast";
import { inApp } from "../cases";
import { isOwnShippedSource, lineOf, walkNodes } from "../source";
import type { FileHit, FileRule } from "../types";

export const rule: FileRule = {
  id: "no-try-catch",
  scope: "file",
  nonNegotiable: 1,
  matches: "A `try` statement outside an `Effect.try` or `Effect.tryPromise` callback.",
  covers: "`app/` and `workers/`, except tests and the ShadCN primitives in `app/components/ui/`.",
  fix:
    "wrap the call that can fail in `Effect.tryPromise({ try: () => call(), catch: (cause) => new SomeError({ cause }) })` " +
    "and handle the failure with `Effect.catchTag`",
  example: "app/repositories/bucket.ts",
  applies: isOwnShippedSource,
  check({ ast }) {
    const hits: FileHit[] = [];
    walkNodes(ast, (node) => {
      if (!ts.isTryStatement(node) || insideEffectTry(node, ast)) return;
      hits.push({ line: lineOf(ast, node), message: "`try`/`catch` outside the Effect error channel" });
    });
    return hits;
  },
  cases: [
    { name: "a bare try/catch is caught", files: inApp("export function f() { try { g(); } catch {} }"), expect: "finding" },
    { name: "try/finally with no catch is caught", files: inApp("export function f() { try { g(); } finally { h(); } }"), expect: "finding" },
    {
      name: "a try inside an Effect.tryPromise callback is allowed",
      files: inApp("export const a = Effect.tryPromise({ try: async () => { try { await g(); } finally { h(); } }, catch: (e) => e });"),
      expect: "clean",
    },
    {
      name: "a ShadCN primitive is outside the rule",
      files: { "app/components/ui/chart.tsx": "export function f() { try { g(); } catch {} }" },
      expect: "clean",
    },
    {
      name: "a test file is outside the rule",
      files: { "app/lib/__tests__/x.test.ts": "export function f() { try { g(); } catch {} }" },
      expect: "clean",
    },
  ],
};
