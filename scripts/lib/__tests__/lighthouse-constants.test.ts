import { describe, expect, it } from "vitest";
import { devVars, lighthouseArgs, previewArgs } from "../lighthouse-constants";

describe("lighthouse-constants", () => {
  it("runs Lighthouse with its mobile defaults, performance only, JSON and HTML out, and never reports errors home", () => {
    const args = lighthouseArgs("/repo/cli.js", "http://localhost:4173/", "/r/head-home-1", undefined);
    expect(args.slice(0, 2)).toEqual(["/repo/cli.js", "http://localhost:4173/"]);
    expect(args).toContain("--only-categories=performance");
    expect(args).toContain("--output=json");
    expect(args).toContain("--output=html");
    expect(args).toContain("--output-path=/r/head-home-1");
    expect(args).toContain("--no-enable-error-reporting");
    expect(args.some((arg) => /form-factor|preset=desktop|screenEmulation/.test(arg))).toBe(false);
    expect(args.some((arg) => arg.startsWith("--extra-headers"))).toBe(false);
  });

  it("sends the session cookie as one JSON header only when the page needs a signed-in user", () => {
    const args = lighthouseArgs("cli.js", "http://localhost:4173/dashboard", "/r/x", "a=1; b=2");
    expect(args.at(-1)).toBe('--extra-headers={"Cookie":"a=1; b=2"}');
  });

  it("serves the production build on a fixed port, and writes the auth URL for that same port", () => {
    expect(previewArgs(4173)).toEqual(["x", "vite", "preview", "--port", "4173", "--strictPort"]);
    expect(devVars(5000, "secret")).toBe("BETTER_AUTH_URL=http://localhost:5000\nBETTER_AUTH_SECRET=secret\n");
  });
});
