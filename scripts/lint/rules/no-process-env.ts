import ts from "typescript";
import { inApp, isShippedSource, lineOf, walkNodes } from "../source";
import type { FileHit, FileRule } from "../types";

const GLOBAL_OBJECTS = new Set(["globalThis", "global"]);

const isNamed = (node: ts.Node, name: string): boolean => ts.isIdentifier(node) && node.text === name;

function processEnvRead(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node) && node.name.text === "env") {
    if (isNamed(node.expression, "process")) return "`process.env`";
    const owner = node.expression;
    const viaGlobal =
      ts.isPropertyAccessExpression(owner) &&
      owner.name.text === "process" &&
      ts.isIdentifier(owner.expression) &&
      GLOBAL_OBJECTS.has(owner.expression.text);
    return viaGlobal ? "`globalThis.process.env`" : undefined;
  }
  if (ts.isElementAccessExpression(node) && isNamed(node.expression, "process")) {
    const key = node.argumentExpression;
    return ts.isStringLiteralLike(key) && key.text === "env" ? '`process["env"]`' : undefined;
  }
  if (ts.isVariableDeclaration(node) && node.initializer && isNamed(node.initializer, "process")) {
    if (!ts.isObjectBindingPattern(node.name)) return undefined;
    const bindsEnv = node.name.elements.some((element) => isNamed(element.propertyName ?? element.name, "env"));
    return bindsEnv ? "`env` destructured off `process`" : undefined;
  }
  return undefined;
}

export const rule: FileRule = {
  id: "no-process-env",
  scope: "file",
  nonNegotiable: 5,
  matches: 'A read of `process.env` in any spelling: `process.env`, `process["env"]`, `globalThis.process.env`, or `const { env } = process`.',
  covers: "`app/` and `workers/`, except tests.",
  fix:
    "a Worker has no `process`. In an Effect, read the binding with `const env = yield* CloudflareEnv` from `app/services/cloudflare.ts`; " +
    "in a loader or action, read `context.cloudflare.env`",
  example: "app/services/database.ts",
  applies: isShippedSource,
  check({ ast }) {
    const hits: FileHit[] = [];
    walkNodes(ast, (node) => {
      const spelling = processEnvRead(node);
      if (spelling) hits.push({ line: lineOf(ast, node), message: `${spelling} read in Worker code` });
    });
    return hits;
  },
  cases: [
    { name: "process.env is caught", files: inApp("export const a = process.env.FOO;"), expect: "finding" },
    { name: 'process["env"] is caught', files: inApp('export const a = process["env"].FOO;'), expect: "finding" },
    { name: "process['env'] is caught", files: inApp("export const a = process['env'];"), expect: "finding" },
    { name: "const { env } = process is caught", files: inApp("const { env } = process; export const a = env.FOO;"), expect: "finding" },
    { name: "const { env: e } = process is caught", files: inApp("const { env: e } = process; export const a = e;"), expect: "finding" },
    { name: "globalThis.process.env is caught", files: inApp("export const a = globalThis.process.env.FOO;"), expect: "finding" },
    { name: "process.versions is not process.env", files: inApp("export const a = process.versions;"), expect: "clean" },
    { name: "another destructure off process is fine", files: inApp("const { argv } = process; export const a = argv;"), expect: "clean" },
    { name: "a ShadCN primitive is inside the rule", files: { "app/components/ui/x.tsx": "export const a = process.env.FOO;" }, expect: "finding" },
  ],
};
