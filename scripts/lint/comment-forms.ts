import type { Comment } from "./comments";

export type Verdict = "legal" | "no-reason" | "banned";

export interface CommentForm {
  name: string;
  example: string;
  banned?: true;
  verdict(comment: Comment): Verdict | undefined;
}

const reasonAfter = (body: string, lead: RegExp): Verdict | undefined => {
  const match = lead.exec(body);
  if (!match) return undefined;
  return body.slice(match[0].length).replace(/^[\s:—-]+/, "").trim() === "" ? "no-reason" : "legal";
};

export const COMMENT_FORMS: CommentForm[] = [
  {
    name: "@ts-expect-error",
    example: "// @ts-expect-error: the library's types omit this field",
    verdict: ({ body }) => reasonAfter(body, /^@ts-expect-error\b/),
  },
  {
    name: "biome-ignore",
    example: "// biome-ignore lint/suspicious/noExplicitAny: the SDK returns any here",
    verdict: ({ body }) => reasonAfter(body, /^biome-ignore(-all|-start|-end)?\s+[^\s:]+\s*:?/),
  },
  {
    name: "pure annotation",
    example: "/* @__PURE__ */",
    verdict: ({ body }) => (/^[@#]__(PURE|NO_SIDE_EFFECTS)__$/.test(body) ? "legal" : undefined),
  },
  {
    name: "triple-slash reference",
    example: '/// <reference types="vite/client" />',
    verdict: ({ text }) => (/^\/\/\/\s*<reference\s[^>]*\/>\s*$/.test(text) ? "legal" : undefined),
  },
  {
    name: "effect-promise-ok",
    example: "// effect-promise-ok: the promise wraps a timer and cannot reject",
    verdict: ({ body }) => reasonAfter(body, /^effect-promise-ok:/),
  },
  {
    name: "secret-scan",
    example: "// secret-scan: allow generic-secret",
    verdict: ({ body }) => (/^secret-scan: allow\s+\S+/.test(body) ? "legal" : undefined),
  },
  {
    name: "eslint-disable",
    example: "// eslint-disable-next-line react-hooks/exhaustive-deps -- the effect must run once",
    verdict: ({ body }) => {
      if (!/^eslint-(disable|enable)\b/.test(body)) return undefined;
      const reason = body.split(/\s--\s/)[1] ?? "";
      return reason.replace(/^[\s:—-]+/, "").trim() === "" ? "no-reason" : "legal";
    },
  },
  {
    name: "@ts-ignore",
    example: "// @ts-ignore",
    banned: true,
    verdict: ({ body }) => (/^@ts-(ignore|nocheck)\b/.test(body) ? "banned" : undefined),
  },
];

export function commentVerdict(comment: Comment): { form: CommentForm; verdict: Verdict } | undefined {
  for (const form of COMMENT_FORMS) {
    const verdict = form.verdict(comment);
    if (verdict) return { form, verdict };
  }
  return undefined;
}
