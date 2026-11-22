import ts from "typescript";
import { inApp, isShippedSource, lineOf, walkNodes } from "../source";
import type { FileHit, FileRule } from "../types";

const ZOD_MODULE = /^zod(\/|$)/;

const firstArgumentIsZod = (call: ts.CallExpression): boolean => {
  const first = call.arguments[0];
  return first !== undefined && ts.isStringLiteralLike(first) && ZOD_MODULE.test(first.text);
};

function zodLoad(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return ZOD_MODULE.test(node.moduleSpecifier.text) ? `imports "${node.moduleSpecifier.text}"` : undefined;
  }
  if (!ts.isCallExpression(node) || !firstArgumentIsZod(node)) return undefined;
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return "imports zod with `import()`";
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1;
  return isRequire ? "loads zod with `require()`" : undefined;
}

export const rule: FileRule = {
  id: "no-zod",
  scope: "file",
  nonNegotiable: 2,
  matches: "Any load of `zod` or a `zod/…` subpath: an `import`, a `require()` or a dynamic `import()`.",
  covers: "`app/` and `workers/`, except tests.",
  fix: 'write the schema with Effect Schema: `import { Schema } from "effect"`, then `Schema.Struct({ … })` and `Schema.decodeUnknown(…)`',
  example: "app/lib/schemas/user.ts",
  applies: isShippedSource,
  check({ ast }) {
    const hits: FileHit[] = [];
    walkNodes(ast, (node) => {
      const message = zodLoad(node);
      if (message) hits.push({ line: lineOf(ast, node), message });
    });
    return hits;
  },
  cases: [
    { name: "single-quoted zod import is caught", files: inApp("import { z } from 'zod';"), expect: "finding" },
    { name: "double-quoted zod import is caught", files: inApp('import { z } from "zod";'), expect: "finding" },
    { name: "a zod subpath is caught", files: inApp("import { z } from 'zod/v4';"), expect: "finding" },
    { name: "a dynamic import of zod is caught", files: inApp('export const a = async () => (await import("zod")).z;'), expect: "finding" },
    { name: "a dynamic import of a zod subpath is caught", files: inApp("export const a = async () => await import('zod/v4');"), expect: "finding" },
    { name: "require of zod is caught", files: inApp('export const z = require("zod");'), expect: "finding" },
    { name: "a package whose name only starts with zod is fine", files: inApp('import { x } from "zodiac";'), expect: "clean" },
    { name: "Effect Schema is fine", files: inApp('import { Schema } from "effect";\nexport const A = Schema.String;'), expect: "clean" },
  ],
};
