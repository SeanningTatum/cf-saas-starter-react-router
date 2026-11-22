import ts from "typescript";
import { isEffectReceiver } from "../effect-ast";
import { inApp } from "../cases";
import { isShippedSource, lineOf, walkNodes } from "../source";
import type { FileHit, FileRule } from "../types";

const MARKER = "effect-promise-ok:";

export const rule: FileRule = {
  id: "no-effect-promise",
  scope: "file",
  nonNegotiable: 1,
  matches: "A call to `Effect.promise`, under any name the Effect module is imported as. A rejection there skips the error channel.",
  covers: "`app/` and `workers/`, except tests.",
  fix:
    "use `Effect.tryPromise({ try, catch })` so a rejection becomes a tagged error. " +
    `Only when the promise cannot reject, keep the call and write \`// ${MARKER} <why it cannot reject>\` on the line above it`,
  example: "app/repositories/bucket.ts",
  applies: isShippedSource,
  suppressionMarker: MARKER,
  check({ ast }) {
    const hits: FileHit[] = [];
    walkNodes(ast, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (node.expression.name.text !== "promise" || !isEffectReceiver(node.expression.expression, ast)) return;
      hits.push({ line: lineOf(ast, node), message: "`Effect.promise` treats a rejection as a defect, not a failure" });
    });
    return hits;
  },
  cases: [
    { name: "Effect.promise is caught", files: inApp("export const a = Effect.promise(() => p());"), expect: "finding" },
    {
      name: "a namespace alias of the Effect module is caught",
      files: inApp('import * as E from "effect/Effect";\nexport const a = E.promise(() => p());'),
      expect: "finding",
    },
    {
      name: "a renamed Effect import is caught",
      files: inApp('import { Effect as Eff } from "effect";\nexport const a = Eff.promise(() => p());'),
      expect: "finding",
    },
    {
      name: "a nested receiver that ends in Effect is caught",
      files: inApp("export const a = Lib.Effect.promise(() => p());"),
      expect: "finding",
    },
    {
      name: "the marker with a reason excuses the call on the next line",
      files: inApp(`// ${MARKER} cannot reject\nexport const a = Effect.promise(() => p());`),
      expect: "clean",
    },
    {
      name: "the marker does not excuse a call five lines away",
      files: inApp(
        `// ${MARKER} cannot reject\nexport const a = Effect.promise(() => p());\nconst x = 1;\nconst y = 2;\nexport const b = Effect.promise(() => q());`
      ),
      expect: "finding",
    },
    {
      name: "the marker with no reason excuses nothing",
      files: inApp(`// ${MARKER}\nexport const a = Effect.promise(() => p());`),
      expect: "finding",
    },
    {
      name: "a marker that excuses no call is itself a finding",
      files: inApp(`// ${MARKER} left behind after the call was removed\nexport const a = 1;`),
      expect: "finding",
    },
    { name: "promise() on a receiver that is not Effect is fine", files: inApp("export const a = queue.promise(() => p());"), expect: "clean" },
  ],
};
