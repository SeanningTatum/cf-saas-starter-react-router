import ts from "typescript";
import { isEffectReceiver } from "../effect-ast";
import { isSourcePath, isTestPath, lineOf, walkNodes } from "../source";
import { calleeName, localsThatReach } from "../span-ast";
import type { FileHit, FileRule } from "../types";

const EXTERNAL_CALL_FILES = /^app\/(?:(?:repositories|services)\/.+|lib\/effect-utils)\.ts$/;
const TRY_PROMISE = "tryPromise";
const WITH_SPAN = "withSpan";
const PIPE = "pipe";

const TRY = "Effect.tryPromise({ try: () => fetch(u), catch: (e) => e })";
const inRepository = (call: string): Record<string, string> => ({
  "app/repositories/x.ts": `import { Effect } from "effect";\nexport const get = () => ${call};\n`,
});

const isPipeCall = (call: ts.CallExpression): boolean => {
  const callee = call.expression;
  return (
    (ts.isPropertyAccessExpression(callee) && callee.name.text === PIPE) ||
    (ts.isIdentifier(callee) && callee.text === PIPE)
  );
};

function pipedIntoSpan(node: ts.Node, spanMakers: ReadonlySet<string>): boolean {
  const makesSpan = (argument: ts.Node): boolean =>
    ts.isCallExpression(argument) && spanMakers.has(calleeName(argument) ?? "");
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (!ts.isCallExpression(parent) || !isPipeCall(parent)) continue;
    const position = parent.expression === child ? -1 : parent.arguments.indexOf(child as ts.Expression);
    if (parent.arguments.some((argument, index) => index > position && makesSpan(argument))) return true;
  }
  return false;
}

export const rule: FileRule = {
  id: "external-call-span",
  scope: "file",
  matches:
    "An `Effect.tryPromise` (an awaited call to D1, R2, Better Auth or another service) that is not piped into `Effect.withSpan`, " +
    "directly, through `Effect.gen(...).pipe(...)`, or through a local helper that makes the span.",
  covers:
    "`app/repositories/`, `app/services/` and `app/lib/effect-utils.ts`, except tests. " +
    "`app/services/tracing.ts` is a boundary: the exporter cannot trace its own export.",
  fix:
    'pipe the call into a client span, `.pipe(Effect.withSpan("<service>.<operation>", { kind: "client" }))`, ' +
    "with the name in `app/lib/constants/spans.ts`, so a slow or failed outside call shows in the trace",
  example: "app/repositories/bucket.ts",
  applies: (path) => EXTERNAL_CALL_FILES.test(path) && isSourcePath(path) && !isTestPath(path),
  check({ ast }) {
    const hits: FileHit[] = [];
    const spanMakers = localsThatReach(ast, WITH_SPAN);
    walkNodes(ast, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (node.expression.name.text !== TRY_PROMISE || !isEffectReceiver(node.expression.expression, ast)) return;
      if (!pipedIntoSpan(node, spanMakers)) {
        hits.push({ line: lineOf(ast, node), message: "`Effect.tryPromise` (an awaited outside call) is not inside a span" });
      }
    });
    return hits;
  },
  cases: [
    { name: "an awaited call in a repository with no span is caught", files: inRepository(TRY), expect: "finding" },
    {
      name: "an awaited call in a service with no span is caught",
      files: { "app/services/payments/x.ts": `export const get = () => ${TRY};` },
      expect: "finding",
    },
    {
      name: "the D1 helpers are covered",
      files: { "app/lib/effect-utils.ts": `export const tryQuery = () => ${TRY};` },
      expect: "finding",
    },
    {
      name: "a renamed Effect import is caught",
      files: {
        "app/repositories/x.ts":
          'import { Effect as Eff } from "effect";\nexport const get = () => Eff.tryPromise({ try: () => fetch(u), catch: (e) => e });',
      },
      expect: "finding",
    },
    {
      name: "a span piped before the call does not wrap it",
      files: inRepository(`Effect.void.pipe(Effect.withSpan("x.get"), Effect.zipRight(${TRY}))`),
      expect: "finding",
    },
    {
      name: "a span on a sibling call does not count",
      files: {
        "app/repositories/x.ts": `export const a = () => ${TRY}.pipe(Effect.withSpan("x.a"));\nexport const b = () => ${TRY};`,
      },
      expect: "finding",
    },
    {
      name: "a comment that names withSpan does not count",
      files: inRepository(`${TRY} /* .pipe(Effect.withSpan("x")) */`),
      expect: "finding",
    },
    {
      name: "a call piped into Effect.withSpan is clean",
      files: inRepository(`${TRY}.pipe(Effect.withSpan("x.get", { kind: "client" }))`),
      expect: "clean",
    },
    {
      name: "a span added later in the same pipe is clean",
      files: inRepository(`${TRY}.pipe(Effect.map((x) => x), Effect.withSpan("x.get"))`),
      expect: "clean",
    },
    {
      name: "the pipe() function form is read",
      files: inRepository(`pipe(${TRY}, Effect.withSpan("x.get"))`),
      expect: "clean",
    },
    {
      name: "a call inside Effect.gen whose result is piped into a span is clean",
      files: inRepository(`Effect.gen(function* () { return yield* ${TRY}; }).pipe(Effect.withSpan("x.get"))`),
      expect: "clean",
    },
    {
      name: "a call piped through a local helper that makes the span is clean",
      files: {
        "app/repositories/x.ts":
          `const span = (n: string) => Effect.withSpan(n, { kind: "client" });\nexport const get = () => ${TRY}.pipe(span("x.get"));`,
      },
      expect: "clean",
    },
    {
      name: "a file outside repositories and services is not checked",
      files: { "app/lib/x.ts": `export const get = () => ${TRY};` },
      expect: "clean",
    },
  ],
};
