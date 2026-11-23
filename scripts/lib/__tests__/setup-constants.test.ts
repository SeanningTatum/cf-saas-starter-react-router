import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_ACCOUNT_ID_PATTERN,
  ENV_SUFFIX,
  GROUP_QUESTIONS,
  SECURITY_HINT,
  SETUP_ENVIRONMENTS,
  TOKEN_PATTERN,
  UNPROTECTED_NOTE,
  WRANGLER_ENV_ARGS,
} from "../setup-constants";
import { GROUP_NAMES } from "../setup-items";

describe("setup-constants", () => {
  it("gives every environment one wrangler argument list and one suffix", () => {
    for (const environment of SETUP_ENVIRONMENTS) {
      expect(WRANGLER_ENV_ARGS[environment]).toBeDefined();
      expect(ENV_SUFFIX[environment]).toBeDefined();
    }
    expect(WRANGLER_ENV_ARGS.production).toEqual([]);
    expect(WRANGLER_ENV_ARGS.preview).toEqual(["--env", "preview"]);
  });

  it("asks one question for every group of items", () => {
    for (const group of GROUP_NAMES) expect(GROUP_QUESTIONS[group]).toBeTruthy();
  });

  it("accepts a 32-character hex account id and refuses anything else", () => {
    expect(CLOUDFLARE_ACCOUNT_ID_PATTERN.test("a".repeat(32))).toBe(true);
    expect(CLOUDFLARE_ACCOUNT_ID_PATTERN.test("A".repeat(32))).toBe(false);
    expect(CLOUDFLARE_ACCOUNT_ID_PATTERN.test("a".repeat(31))).toBe(false);
  });

  it("takes a token of 20 or more characters with no space", () => {
    expect(TOKEN_PATTERN.test("t".repeat(20))).toBe(true);
    expect(TOKEN_PATTERN.test("t".repeat(19))).toBe(false);
    expect(TOKEN_PATTERN.test(`${"t".repeat(20)} x`)).toBe(false);
  });

  it("names the command that protects the environment in the note about an unprotected token", () => {
    expect(UNPROTECTED_NOTE).toContain(SECURITY_HINT);
  });
});
