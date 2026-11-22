import { inApp } from "../cases";
import { COMMENT_FORMS, commentVerdict } from "../comment-forms";
import { commentsIn, type Comment } from "../comments";
import { WORKFLOW_SOURCE_DIR, WORKFLOW_SOURCE_FILE } from "../constants";
import { isSizedSource } from "../source";
import type { FileHit, FileRule } from "../types";

const FIX =
  "say it in code. A limit or constraint becomes a named constant or a type; what a test catches goes in the test's title; " +
  "a design or security reason goes in the feature's doc (`docs/features/<feature>.md`) or an ADR (`docs/adr/NNNN-<slug>.md`); a comment that restates the code is deleted";

const LEGAL_NAMES = COMMENT_FORMS.filter((form) => !form.banned)
  .map((form) => `\`${form.name}\``)
  .join(", ");

const isWorkflowSource = (path: string): boolean => path.startsWith(`${WORKFLOW_SOURCE_DIR}/`) && WORKFLOW_SOURCE_FILE.test(path);

const applies = (path: string): boolean => isSizedSource(path) || isWorkflowSource(path);

function hitFor(comment: Comment): FileHit | undefined {
  const known = commentVerdict(comment);
  if (!known) return { line: comment.line, message: "a comment" };
  if (known.verdict === "legal") return undefined;
  if (known.verdict === "banned") {
    return {
      line: comment.line,
      message: `\`${known.form.name}\` hides every error on the line`,
      fix: "fix the type, or use `// @ts-expect-error: <why>` so the comment fails once the error is gone",
    };
  }
  return {
    line: comment.line,
    message: `the \`${known.form.name}\` directive has no reason`,
    fix: `write the reason in the comment, like \`${known.form.example}\``,
  };
}

export const rule: FileRule = {
  id: "no-comments",
  scope: "file",
  matches: `Any comment, JSX comments included. Only tool directives are legal, each with a reason where the tool takes one: ${LEGAL_NAMES}. \`@ts-ignore\` is banned.`,
  covers:
    "`.ts` and `.tsx` under `app/`, `workers/`, `e2e/` and `scripts/`, tests included, and `.js` under `.claude/workflow-src/`. " +
    "Not the ShadCN primitives in `app/components/ui/`.",
  fix: FIX,
  applies,
  check(source) {
    return commentsIn(source).flatMap((comment) => hitFor(comment) ?? []);
  },
  cases: [
    { name: "a line comment is caught", files: inApp("// explains the next line\nexport const a = 1;\n"), expect: "finding" },
    { name: "a block comment is caught", files: inApp("/* explains */\nexport const a = 1;\n"), expect: "finding" },
    { name: "a JSDoc block is caught", files: inApp("/** Adds one. */\nexport function f(a: number) { return a + 1; }\n"), expect: "finding" },
    { name: "a comment at the end of a line of code is caught", files: inApp("export const a = 1; // one\n"), expect: "finding" },
    { name: "a comment after the last statement is caught", files: inApp("export const a = 1;\n// the end\n"), expect: "finding" },
    {
      name: "a comment inside JSX is caught",
      files: { "app/components/card.tsx": "export function Card() {\n  return (\n    <div>\n      {/* the title goes here */}\n      <h1>Hi</h1>\n    </div>\n  );\n}\n" },
      expect: "finding",
    },
    {
      name: "text inside JSX that looks like a comment is not one",
      files: { "app/components/card.tsx": "export function Card() {\n  return <p>see http://example.com // not a comment</p>;\n}\n" },
      expect: "clean",
    },
    { name: "slashes inside a string, a template and a regex are not comments", files: inApp('export const a = "http://x"; export const b = `// ${a} /* x */`; export const c = /\\/\\//;\n'), expect: "clean" },
    { name: "a test file is inside the rule", files: { "app/lib/__tests__/thing.test.ts": "// Catches: the off-by-one\nexport const a = 1;\n" }, expect: "finding" },
    { name: "an e2e spec is inside the rule", files: { "e2e/home.spec.ts": "// logs in first\nexport const a = 1;\n" }, expect: "finding" },
    { name: "a script is inside the rule", files: { "scripts/job.ts": "#!/usr/bin/env bun\n// does the job\nexport const a = 1;\n" }, expect: "finding" },
    { name: "a shebang line is not a comment", files: { "scripts/job.ts": "#!/usr/bin/env bun\nexport const a = 1;\n" }, expect: "clean" },
    { name: "a workflow source file is inside the rule", files: { ".claude/workflow-src/flow.js": "// step one\nconst a = 1;\n" }, expect: "finding" },
    { name: "the workflow library marker the build needs is legal", files: { ".claude/workflow-src/flow.js": "const a = 1;\n// @lib\nconst b = 2;\n" }, expect: "clean" },
    { name: "a directive followed by lines of prose is a comment, not a directive", files: inApp("/* @ts-expect-error: the SDK types omit this field,\n   and here is the history of why */\nexport const a: number = b;\n"), expect: "finding" },
    { name: "secret-scan with prose after its rule is a comment", files: inApp('export const a = "x"; // secret-scan: allow generic-secret because of a long story\n'), expect: "finding" },
    { name: "biome-ignore with prose in place of a rule is a comment", files: inApp("// biome-ignore this is really just a note\nexport const a = 1;\n"), expect: "finding" },
    { name: "a ShadCN primitive is outside the rule", files: { "app/components/ui/button.tsx": "// upstream note\nexport const a = 1;\n" }, expect: "clean" },
    { name: "@ts-expect-error with a reason is legal", files: inApp("// @ts-expect-error: the SDK types omit this field\nexport const a: number = b;\n"), expect: "clean" },
    { name: "@ts-expect-error with no reason is caught", files: inApp("// @ts-expect-error\nexport const a: number = b;\n"), expect: "finding" },
    { name: "@ts-ignore is banned even with a reason", files: inApp("// @ts-ignore: the SDK types omit this field\nexport const a: number = b;\n"), expect: "finding" },
    { name: "biome-ignore with a rule and a reason is legal", files: inApp("// biome-ignore lint/suspicious/noExplicitAny: the SDK returns any\nexport const a = 1;\n"), expect: "clean" },
    { name: "biome-ignore with no reason is caught", files: inApp("// biome-ignore lint/suspicious/noExplicitAny\nexport const a = 1;\n"), expect: "finding" },
    { name: "the pure annotation is legal", files: inApp("export const a = /* @__PURE__ */ make();\n"), expect: "clean" },
    { name: "a triple-slash reference is legal", files: inApp('/// <reference types="vite/client" />\nexport const a = 1;\n'), expect: "clean" },
    { name: "a triple-slash line that is not a reference is a comment", files: inApp("/// just three slashes\nexport const a = 1;\n"), expect: "finding" },
    { name: "the repo's own marker with a reason is legal", files: inApp("// effect-promise-ok: wraps a timer, cannot reject\nexport const a = 1;\n"), expect: "clean" },
    { name: "the repo's own marker with no reason is caught", files: inApp("// effect-promise-ok:\nexport const a = 1;\n"), expect: "finding" },
    { name: "the secret-scan marker with its rule is legal", files: inApp('export const a = "x"; // secret-scan: allow generic-secret\n'), expect: "clean" },
    { name: "an eslint-disable line with no reason is caught", files: inApp("// eslint-disable-next-line react-hooks/exhaustive-deps\nexport const a = 1;\n"), expect: "finding" },
    { name: "a comment that only starts like a directive is still a comment", files: inApp("// @ts-expect-errors are bad, see the wiki\nexport const a = 1;\n"), expect: "finding" },
  ],
};
