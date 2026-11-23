import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..", "..");
const code = (file: string): string =>
  fs
    .readFileSync(path.join(ROOT, ".github", "workflows", file), "utf-8")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const SCAN = "bun scripts/ci/sandbox-absent.ts";
const WORKFLOWS = fs.readdirSync(path.join(ROOT, ".github", "workflows")).filter((file) => file.endsWith(".yml"));

describe("the sandbox build switch in the workflows (issue #47)", () => {
  it("is set by the preview build alone, so no production or staging build can turn the sandbox on", () => {
    const setters = WORKFLOWS.filter((file) => /VITE_SANDBOX\s*:/.test(code(file)));
    expect(setters).toEqual(["preview.yml"]);
    expect(code("preview.yml")).toMatch(/CLOUDFLARE_ENV: preview\s*\n\s+VITE_SANDBOX: "1"\s*\n\s+run: bun run build/);
  });

  it.each([
    ["deploy.yml", "run: bun run build", "bun scripts/ci/rollout.ts"],
    ["deploy-staging.yml", "run: bun run build", "bunx wrangler deploy"],
  ])("%s scans the build it ships after building and before deploying, so sandbox code never reaches that Worker", (file, build, deploy) => {
    const text = code(file);
    const order = [build, SCAN, deploy].map((needle) => text.indexOf(needle));
    expect(
      order.every((index) => index >= 0),
      `${file} lacks a step`,
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("CI scans its production build through the declared gate, after the build gate", () => {
    const text = code("ci.yml");
    expect(text.indexOf("./scripts/verify.sh --only sandbox-absent")).toBeGreaterThan(text.indexOf("./scripts/verify.sh --only build"));
  });
});
