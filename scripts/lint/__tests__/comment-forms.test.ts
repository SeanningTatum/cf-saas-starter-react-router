import { describe, expect, it } from "vitest";
import { COMMENT_FORMS, commentVerdict } from "../comment-forms";
import { commentBody, type Comment } from "../comments";

const commentOf = (text: string): Comment => ({ pos: 0, line: 1, text, body: commentBody(text) });

const verdictOf = (text: string) => {
  const known = commentVerdict(commentOf(text));
  return known && { form: known.form.name, verdict: known.verdict };
};

describe("COMMENT_FORMS", () => {
  it("names every form in order with whether it is banned, so adding, removing or reordering one shows in this test's diff", () => {
    expect(COMMENT_FORMS.map((form) => [form.name, form.banned === true])).toEqual([
      ["@ts-expect-error", false],
      ["biome-ignore", false],
      ["pure annotation", false],
      ["triple-slash reference", false],
      ["effect-promise-ok", false],
      ["secret-scan", false],
      ["eslint-disable", false],
      ["@ts-ignore", true],
    ]);
  });

  it.each(COMMENT_FORMS.map((form) => [form.name, form] as const))(
    "the %s example is claimed by its own form, legal unless the form is banned",
    (_name, form) => {
      expect(commentVerdict(commentOf(form.example))).toEqual({ form, verdict: form.banned ? "banned" : "legal" });
    }
  );
});

describe("commentVerdict", () => {
  it.each([
    ["@ts-expect-error", "// @ts-expect-error"],
    ["@ts-expect-error", "// @ts-expect-error:"],
    ["@ts-expect-error", "// @ts-expect-error -"],
    ["@ts-expect-error", "/* @ts-expect-error: - */"],
    ["biome-ignore", "// biome-ignore lint/suspicious/noExplicitAny"],
    ["biome-ignore", "// biome-ignore lint/suspicious/noExplicitAny:"],
    ["biome-ignore", "// biome-ignore lint/suspicious/noExplicitAny: -"],
    ["effect-promise-ok", "// effect-promise-ok:"],
    ["effect-promise-ok", "// effect-promise-ok: -"],
    ["effect-promise-ok", "// effect-promise-ok::"],
    ["eslint-disable", "// eslint-disable-next-line react-hooks/exhaustive-deps"],
    ["eslint-disable", "// eslint-disable-next-line react-hooks/exhaustive-deps:"],
    ["eslint-disable", "// eslint-disable-next-line react-hooks/exhaustive-deps --"],
    ["eslint-disable", "// eslint-disable-next-line react-hooks/exhaustive-deps -- -"],
    ["eslint-disable", "/* eslint-disable */"],
  ])("%s with no reason, or only punctuation after it, is no-reason: %j", (form, text) => {
    expect(verdictOf(text)).toEqual({ form, verdict: "no-reason" });
  });

  it.each([
    ["@ts-expect-error", "// @ts-expect-error the SDK omits this field"],
    ["biome-ignore", "// biome-ignore-all lint/style/useNamingConvention: generated names"],
    ["pure annotation", "/* #__PURE__ */"],
    ["pure annotation", "/* @__NO_SIDE_EFFECTS__ */"],
    ["triple-slash reference", '/// <reference path="./worker-configuration.d.ts" />'],
    ["effect-promise-ok", "// effect-promise-ok: the timer cannot reject"],
    ["secret-scan", "// secret-scan: allow generic-secret"],
    ["eslint-disable", "/* eslint-disable no-console -- a CLI prints */"],
  ])("%s in another legal spelling is legal: %j", (form, text) => {
    expect(verdictOf(text)).toEqual({ form, verdict: "legal" });
  });

  it.each([
    "// @ts-ignore",
    "// @ts-ignore: the SDK types omit this field",
    "/* @ts-ignore */",
    "// @ts-nocheck",
    "// @ts-nocheck because the file is generated",
  ])("@ts-ignore and @ts-nocheck are banned, a reason or not: %j", (text) => {
    expect(verdictOf(text)).toEqual({ form: "@ts-ignore", verdict: "banned" });
  });

  it.each([
    "// @ts-expect-errors are bad, see the wiki",
    "// a note about @ts-expect-error",
    "// biome-ignored for now",
    "// eslint-disabled earlier",
    "// effect-promise-okay",
    "/* @__PURE__ and more */",
    "/// just a comment",
    '// <reference types="vite/client" />',
    "// secret-scan: allow",
    "// secret-scan: allow   ",
  ])("a comment that only looks like a directive is claimed by no form: %j", (text) => {
    expect(commentVerdict(commentOf(text))).toBeUndefined();
  });
});
