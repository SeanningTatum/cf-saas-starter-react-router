import type { Comment } from "./comments";
import { EFFECT_PROMISE_MARKER, MAX_DIRECTIVE_CHARS } from "./constants";

export type Verdict = "legal" | "no-reason" | "banned";

export interface CommentForm {
  name: string;
  example: string;
  banned?: true;
  verdict(comment: Comment): Verdict | undefined;
}

const LEADING_PUNCTUATION = /^[\s:—-]+/;
const TS_EXPECT_ERROR = /^@ts-expect-error(?![\w-])/;
const BIOME_IGNORE = /^biome-ignore(-all|-start|-end)?\s+(lint(\/[\w-]+){1,2}|(format|assist|syntax|plugin)(\/[\w-]+)*)(?=[\s:]|$)/;
const ESLINT_DISABLE = /^eslint-(disable|enable)(-next-line|-line)?(\s+[@\w/-]+(\s*,\s*[@\w/-]+)*)?(\s+--(\s.*)?)?$/;
const ESLINT_REASON_GROUP = 6;
const REFERENCE = /^\/\/\/\s*<reference\s+(types|path|lib|no-default-lib)="[^"]*"\s*\/>\s*$/;

const reasoned = (rest: string): Verdict => (rest.replace(LEADING_PUNCTUATION, "").trim() === "" ? "no-reason" : "legal");

const reasonAfterColon = (body: string, lead: RegExp): Verdict | undefined => {
  const match = lead.exec(body);
  if (!match) return undefined;
  const rest = body.slice(match[0].length).trimStart();
  return rest.startsWith(":") ? reasoned(rest) : "no-reason";
};

export const COMMENT_FORMS: CommentForm[] = [
  {
    name: "@ts-expect-error",
    example: "// @ts-expect-error: the library's types omit this field",
    verdict: ({ body }) => reasonAfterColon(body, TS_EXPECT_ERROR),
  },
  {
    name: "biome-ignore",
    example: "// biome-ignore lint/suspicious/noExplicitAny: the SDK returns any here",
    verdict: ({ body }) => reasonAfterColon(body, BIOME_IGNORE),
  },
  {
    name: "pure annotation",
    example: "/* @__PURE__ */",
    verdict: ({ body }) => (/^[@#]__(PURE|NO_SIDE_EFFECTS)__$/.test(body) ? "legal" : undefined),
  },
  {
    name: "triple-slash reference",
    example: '/// <reference types="vite/client" />',
    verdict: ({ text }) => (REFERENCE.test(text) ? "legal" : undefined),
  },
  {
    name: "effect-promise-ok",
    example: `// ${EFFECT_PROMISE_MARKER} the promise wraps a timer and cannot reject`,
    verdict: ({ body }) => (body.startsWith(EFFECT_PROMISE_MARKER) ? reasoned(body.slice(EFFECT_PROMISE_MARKER.length)) : undefined),
  },
  {
    name: "secret-scan",
    example: "// secret-scan: allow generic-secret",
    verdict: ({ body }) => (/^secret-scan: allow [a-z-]+$/.test(body) ? "legal" : undefined),
  },
  {
    name: "workflow library marker",
    example: "// @lib",
    verdict: ({ body }) => (body === "@lib" ? "legal" : undefined),
  },
  {
    name: "harness fence marker",
    example: "// harness:primitive-fences:start",
    verdict: ({ body }) => (/^harness:primitive-fences:(start|end)$/.test(body) ? "legal" : undefined),
  },
  {
    name: "eslint-disable",
    example: "// eslint-disable-next-line react-hooks/exhaustive-deps -- the effect must run once",
    verdict: ({ body }) => {
      const match = ESLINT_DISABLE.exec(body);
      return match ? reasoned(match[ESLINT_REASON_GROUP] ?? "") : undefined;
    },
  },
  {
    name: "@ts-ignore",
    example: "// @ts-ignore",
    banned: true,
    verdict: ({ body }) => (/^@ts-(ignore|nocheck)(?![\w-])/.test(body) ? "banned" : undefined),
  },
];

const isOneShortLine = (comment: Comment): boolean => !comment.text.includes("\n") && comment.body.length <= MAX_DIRECTIVE_CHARS;

export function commentVerdict(comment: Comment): { form: CommentForm; verdict: Verdict } | undefined {
  if (!isOneShortLine(comment)) return undefined;
  for (const form of COMMENT_FORMS) {
    const verdict = form.verdict(comment);
    if (verdict) return { form, verdict };
  }
  return undefined;
}
