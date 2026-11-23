import { describe, expect, it } from "vitest";
import { allResolved, isResolved, parseSetupArgs, type SetupRequest } from "../setup-args";
import { itemById, SETUP_ITEMS } from "../setup-items";

const TOKEN = "tok-prod-AAAAAAAAAAAAAAAAAAAA";

const parse = (argv: string[], env: Record<string, string> = {}, stdin = ""): SetupRequest => parseSetupArgs({ argv, env, readStdin: () => stdin });

describe("parseSetupArgs", () => {
  it("reads a flag with a space or an equals sign", () => {
    expect(parse(["--auth-url", "https://app.example.com"]).values.get("auth-url")).toBe("https://app.example.com");
    expect(parse(["--auth-url=https://app.example.com"]).values.get("auth-url")).toBe("https://app.example.com");
  });

  it("reads the same value from SETUP_<ITEM>, and lets the flag win", () => {
    expect(parse([], { SETUP_AUTH_URL: "https://env.example.com" }).values.get("auth-url")).toBe("https://env.example.com");
    expect(parse(["--auth-url", "https://flag.example.com"], { SETUP_AUTH_URL: "https://env.example.com" }).values.get("auth-url")).toBe(
      "https://flag.example.com",
    );
  });

  it("refuses a secret on the command line: argv shows in the process list", () => {
    const request = parse(["--production-token", TOKEN]);
    expect(request.values.has("production-token")).toBe(false);
    expect(request.errors.join("\n")).toMatch(/never goes on the command line/);
    expect(request.errors.join("\n")).not.toContain(TOKEN);
  });

  it("takes a secret from standard input with =- or from its variable", () => {
    expect(parse(["--production-token=-"], {}, `${TOKEN}\n`).values.get("production-token")).toBe(TOKEN);
    expect(parse([], { SETUP_PRODUCTION_TOKEN: TOKEN }).values.get("production-token")).toBe(TOKEN);
  });

  it("lets only one item read standard input", () => {
    const request = parse(["--production-token=-", "--preview-token=-"], {}, TOKEN);
    expect(request.values.has("production-token")).toBe(true);
    expect(request.values.has("preview-token")).toBe(false);
    expect(request.errors.join("\n")).toMatch(/one value/);
  });

  it("checks each value and does not echo it", () => {
    const request = parse(["--auth-url", "http://plain.example.com/SECRETISH"]);
    expect(request.values.size).toBe(0);
    expect(request.errors).toHaveLength(1);
    expect(request.errors.join("")).not.toContain("SECRETISH");
  });

  it("expands a skip by item, group, environment and all", () => {
    expect(parse(["--skip", "sentry-dsn"]).skips.has("sentry-dsn")).toBe(true);
    const turnstile = parse(["--skip", "turnstile"]).skips;
    expect(turnstile.has("turnstile-site-key") && turnstile.has("turnstile-secret-key-staging")).toBe(true);
    expect(parse(["--skip", "staging"]).skips.has("auth-url-staging")).toBe(true);
    expect(parse(["--skip", "all"]).skips.size).toBe(SETUP_ITEMS.length);
  });

  it("reports an unknown skip, an unknown option and a stray argument", () => {
    expect(parse(["--skip", "nope"]).errors).toHaveLength(1);
    expect(parse(["--nope", "x"]).errors.join("")).toMatch(/unknown option/);
    expect(parse(["stray"]).errors.join("")).toMatch(/unexpected argument/);
    expect(parse(["--auth-url"]).errors.join("")).toMatch(/needs a value/);
  });

  it("reads the mode flags", () => {
    const request = parse(["--check", "--yes", "--provision", "--security", "--rotate-auth-secret", "--no-r2", "--project-name", "demo"]);
    expect(request).toMatchObject({
      check: true,
      yes: true,
      provision: true,
      security: true,
      rotateAuthSecret: true,
      r2: false,
      projectName: "demo",
      errors: [],
    });
    expect(parse(["--no-security"]).security).toBe(false);
    expect(parse([]).security).toBeUndefined();
  });
});

describe("allResolved", () => {
  it("is true once every item that is not generated has a value or a skip", () => {
    expect(allResolved(parse([]))).toBe(false);
    expect(allResolved(parse(["--skip", "all"]))).toBe(true);
    const item = itemById("auth-url");
    expect(item && isResolved(parse(["--auth-url", "https://a.example.com"]), item)).toBe(true);
  });
});
