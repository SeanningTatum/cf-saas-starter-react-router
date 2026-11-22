import { MAX_FILE_LINES, SIZED_ROOTS } from "../constants";
import { isSizedSource } from "../source";
import type { FileRule } from "../types";

const lineCount = (text: string): number => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

const lines = (count: number): string => Array.from({ length: count }, (_, index) => `export const line${index} = ${index};`).join("\n");

export const rule: FileRule = {
  id: "file-size",
  scope: "file",
  matches: `A file longer than ${MAX_FILE_LINES} lines. The finding weighs as many as the file has lines, so a file in the baseline may shrink and may not grow.`,
  covers: `\`.ts\` and \`.tsx\` under ${SIZED_ROOTS.map((root) => `\`${root}/\``).join(", ")}, tests included. Not the ShadCN primitives in \`app/components/ui/\`.`,
  fix: "split it by responsibility: move a component, a group of helpers, a table's columns or a set of test cases to its own file beside this one",
  applies: isSizedSource,
  check({ text }) {
    const count = lineCount(text);
    return count > MAX_FILE_LINES ? [{ line: MAX_FILE_LINES + 1, weight: count, message: `the file has ${count} lines; the cap is ${MAX_FILE_LINES}` }] : [];
  },
  cases: [
    { name: "a file one line over the cap is caught", files: { "app/lib/big.ts": `${lines(MAX_FILE_LINES + 1)}\n` }, expect: "finding" },
    { name: "a file at the cap is fine", files: { "app/lib/full.ts": lines(MAX_FILE_LINES) }, expect: "clean" },
    { name: "the newline that ends the file is not a line", files: { "app/lib/full.ts": `${lines(MAX_FILE_LINES)}\n` }, expect: "clean" },
    { name: "a long test file is caught", files: { "app/lib/__tests__/big.test.ts": lines(MAX_FILE_LINES + 1) }, expect: "finding" },
    { name: "a long e2e spec is caught", files: { "e2e/big.spec.ts": lines(MAX_FILE_LINES + 1) }, expect: "finding" },
    { name: "a long script is caught", files: { "scripts/big.ts": lines(MAX_FILE_LINES + 1) }, expect: "finding" },
    { name: "a ShadCN primitive is outside the rule", files: { "app/components/ui/sidebar.tsx": lines(MAX_FILE_LINES + 1) }, expect: "clean" },
    { name: "a file that is not TypeScript is outside the rule", files: { "app/locales/en.json": lines(MAX_FILE_LINES + 1) }, expect: "clean" },
  ],
};
