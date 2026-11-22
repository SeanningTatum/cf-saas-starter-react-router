import type ts from "typescript";
import { inApp } from "../cases";
import { CONSTANTS_DIR } from "../constants";
import { literalConstants } from "../literals";
import { isOwnShippedSource, lineOf } from "../source";
import type { FileRule } from "../types";

const ROUTE_MODULE_EXPORTS = new Set(["handle"]);

const nameOf = (declaration: ts.VariableDeclaration, ast: ts.SourceFile): string => declaration.name.getText(ast);

export const rule: FileRule = {
  id: "constants-home",
  scope: "file",
  matches:
    "A module-level `const` whose value is a literal: a number, a string, a regex, arithmetic on those, or an array, object, `Set` or `Map` of those. " +
    "The rule reads the value, not the case of the name. An exported `handle` is left alone: React Router reads it from the route module.",
  covers: `\`app/\` and \`workers/\`, except \`${CONSTANTS_DIR}\`, tests and the ShadCN primitives in \`app/components/ui/\`.`,
  fix: `move it to \`${CONSTANTS_DIR}<domain>.ts\` (one file per domain), export it there and import it here; a value used in one function only can be a \`const\` inside that function`,
  example: "app/lib/constants/upload.ts",
  applies: (path) => isOwnShippedSource(path) && !path.startsWith(CONSTANTS_DIR),
  check({ ast }) {
    return literalConstants(ast, ROUTE_MODULE_EXPORTS).map((declaration) => ({
      line: lineOf(ast, declaration),
      message: `the module-level constant \`${nameOf(declaration, ast)}\` holds a literal`,
    }));
  },
  cases: [
    { name: "an upper-case number constant is caught", files: inApp("const MAX_SIZE = 10;\nexport const f = () => MAX_SIZE;\n"), expect: "finding" },
    { name: "a camel-case constant is caught, since the rule reads the value", files: inApp("const maxSize = 10;\nexport const f = () => maxSize;\n"), expect: "finding" },
    { name: "an exported string constant is caught", files: inApp('export const cookieName = "locale";\n'), expect: "finding" },
    { name: "arithmetic on literals is caught", files: inApp("const LIMIT = 10 * 1024 * 1024;\nexport const f = () => LIMIT;\n"), expect: "finding" },
    { name: "a negative number is caught", files: inApp("const OFFSET = -1;\nexport const f = () => OFFSET;\n"), expect: "finding" },
    { name: "a regex is caught", files: inApp("const SLUG = /^[a-z-]+$/;\nexport const f = (s: string) => SLUG.test(s);\n"), expect: "finding" },
    { name: "an array of literals with `as const` is caught", files: inApp('export const locales = ["en", "zh"] as const;\n'), expect: "finding" },
    { name: "an object of literals is caught", files: inApp('const LABELS = { on: "On", off: "Off" };\nexport const f = () => LABELS;\n'), expect: "finding" },
    { name: "a Set of literals is caught", files: inApp('const ALLOWED = new Set(["a", "b"]);\nexport const f = (s: string) => ALLOWED.has(s);\n'), expect: "finding" },
    { name: "a template with no substitution is caught", files: inApp("const PATH = `/api/upload-file`;\nexport const f = () => PATH;\n"), expect: "finding" },
    { name: "a route module's exported `handle` is left where React Router reads it", files: { "app/routes/home.tsx": 'export const handle = { i18n: ["home"] };\n' }, expect: "clean" },
    { name: "a `handle` that is not exported is an ordinary constant", files: inApp('const handle = { i18n: ["home"] };\nexport const f = () => handle;\n'), expect: "finding" },
    { name: "a constant inside a function is fine", files: inApp("export function f() { const limit = 10; return limit; }\n"), expect: "clean" },
    { name: "a constant built from a call is fine", files: inApp("export const logger = createLogger();\n"), expect: "clean" },
    { name: "an object that holds a function is fine", files: inApp("export const handlers = { run: () => 1 };\n"), expect: "clean" },
    { name: "a template with a substitution is fine", files: inApp("export const url = `${base}/api`;\n"), expect: "clean" },
    { name: "an empty array is fine", files: inApp("export const seen: string[] = [];\n"), expect: "clean" },
    { name: "a `let` is not a constant", files: inApp("let count = 0;\nexport const next = () => ++count;\n"), expect: "clean" },
    { name: "the constants folder is where they live", files: { "app/lib/constants/upload.ts": "export const MAX_SIZE = 10 * 1024 * 1024;\n" }, expect: "clean" },
    { name: "a test file is outside the rule", files: { "app/lib/__tests__/thing.test.ts": "const MAX = 10;\nexport const f = () => MAX;\n" }, expect: "clean" },
    { name: "a ShadCN primitive is outside the rule", files: { "app/components/ui/sidebar.tsx": 'const SIDEBAR_WIDTH = "16rem";\nexport const f = () => SIDEBAR_WIDTH;\n' }, expect: "clean" },
    { name: "a worker file is inside the rule", files: { "workers/app.ts": "const TIMEOUT_MS = 30 * 1000;\nexport const f = () => TIMEOUT_MS;\n" }, expect: "finding" },
  ],
};
