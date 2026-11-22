import ts from "typescript";
import { insideEffectTry } from "../effect-ast";
import { inApp } from "../cases";
import { isOwnShippedSource, lineOf, walkNodes } from "../source";
import type { FileHit, FileRule } from "../types";

const FRAMEWORK_THROW_CALLEES = new Set(["redirect", "redirectDocument", "data"]);
const REACT_ROUTER_MODULE = /^react-router(\/|$)/;

function reactRouterImports(ast: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (!REACT_ROUTER_MODULE.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text);
    }
  }
  return names;
}

function isFrameworkControlFlow(node: ts.ThrowStatement, imported: Set<string>): boolean {
  const thrown = node.expression;
  if (!ts.isCallExpression(thrown) || !ts.isIdentifier(thrown.expression)) return false;
  return FRAMEWORK_THROW_CALLEES.has(thrown.expression.text) && imported.has(thrown.expression.text);
}

export const rule: FileRule = {
  id: "no-throw",
  scope: "file",
  nonNegotiable: 1,
  matches: "A `throw` statement outside an `Effect.try` or `Effect.tryPromise` callback.",
  covers: "`app/` and `workers/`, except tests and the ShadCN primitives in `app/components/ui/`.",
  fix:
    "return `Effect.fail(new SomeError({ … }))` with a tagged error class from `app/models/errors/`, " +
    "or wrap the call that can fail in `Effect.tryPromise({ try, catch })`. " +
    "In a loader or action, `throw redirect(…)` and `throw data(…)` imported from `react-router` are allowed",
  example: "app/repositories/bucket.ts",
  applies: isOwnShippedSource,
  check({ ast }) {
    const routerImports = reactRouterImports(ast);
    const hits: FileHit[] = [];
    walkNodes(ast, (node) => {
      if (!ts.isThrowStatement(node)) return;
      if (insideEffectTry(node, ast) || isFrameworkControlFlow(node, routerImports)) return;
      hits.push({ line: lineOf(ast, node), message: "`throw` outside the Effect error channel" });
    });
    return hits;
  },
  cases: [
    { name: "a rethrow with no `new` is caught", files: inApp("export function f(e: Error) { throw e; }"), expect: "finding" },
    { name: "throw new Error is caught", files: inApp("export function f() { throw new Error('x'); }"), expect: "finding" },
    {
      name: "a throw inside Effect.tryPromise is allowed",
      files: inApp("export const a = Effect.tryPromise({ try: () => { throw new Error('x'); }, catch: (e) => e });"),
      expect: "clean",
    },
    {
      name: "throw data(err) with a local data() is not framework control flow",
      files: inApp("const data = (e: unknown) => e;\nexport function f(err: Error) { throw data(err); }"),
      expect: "finding",
    },
    {
      name: "throw redirect() with the react-router import is allowed",
      files: inApp('import { redirect } from "react-router";\nexport function f() { throw redirect("/login"); }'),
      expect: "clean",
    },
    {
      name: "throw redirect() without the react-router import is caught",
      files: inApp('const redirect = (s: string) => s;\nexport function f() { throw redirect("/x"); }'),
      expect: "finding",
    },
    {
      name: "foo.try() on a receiver that is not Effect does not excuse a throw",
      files: inApp("export const a = foo.try(() => { throw new Error('x'); });"),
      expect: "finding",
    },
    {
      name: "Effect.try() excuses a throw",
      files: inApp("export const a = Effect.try(() => { throw new Error('x'); });"),
      expect: "clean",
    },
    {
      name: "an aliased Effect module excuses a throw the same way",
      files: inApp('import * as E from "effect/Effect";\nexport const a = E.try(() => { throw new Error("x"); });'),
      expect: "clean",
    },
    {
      name: "a ShadCN primitive's context guard is outside the rule",
      files: { "app/components/ui/form.tsx": "export function useField() { throw new Error('outside <Form>'); }" },
      expect: "clean",
    },
    {
      name: "a test file is outside the rule",
      files: { "app/lib/__tests__/x.test.ts": "export function f() { throw new Error('x'); }" },
      expect: "clean",
    },
    {
      name: "a worker file is inside the rule",
      files: { "workers/app.ts": "export function f() { throw new Error('x'); }" },
      expect: "finding",
    },
  ],
};
