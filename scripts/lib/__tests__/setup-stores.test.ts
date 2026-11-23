import { describe, expect, it } from "vitest";
import { itemById, SETUP_ITEMS } from "../setup-items";
import type { Runner } from "../setup-run";
import { ensureGhEnvironment, putItem, putNamedGhSecret, wranglerSecretArgs } from "../setup-stores";
import { everythingSaid, newWorld, worldRunner } from "./helpers/setup-world";

const SENTINEL = "SENTINEL-value-0123456789abcdefghij";
const secretItems = SETUP_ITEMS.filter((item) => item.secret);

describe("putItem sends each secret on standard input only", () => {
  it.each(secretItems.map((item) => [item.id, item] as const))("%s", (_id, item) => {
    const world = newWorld();
    const error = putItem(item, SENTINEL, { run: worldRunner(world), accountId: "a".repeat(32) });
    expect(error).toBeUndefined();
    const withValue = world.calls.filter((call) => call.input === SENTINEL);
    expect(withValue.length).toBeGreaterThanOrEqual(1);
    expect(everythingSaid(world)).not.toContain(SENTINEL);
  });
});

describe("a failed put never repeats the secret", () => {
  const echoing: Runner = (_file, _args, options) => ({ code: 1, stdout: "", stderr: `rejected ${options?.input ?? ""}` });
  it.each(secretItems.map((item) => [item.id, item] as const))("%s", (_id, item) => {
    const error = putItem(item, SENTINEL, { run: echoing });
    expect(error).toBeDefined();
    expect(error).not.toContain(SENTINEL);
  });

  it("covers the seed secret helper too", () => {
    expect(putNamedGhSecret("PREVIEW_SEED_SECRET", SENTINEL, { run: echoing })).not.toContain(SENTINEL);
  });
});

describe("wrangler secrets", () => {
  it("targets the environment's own worker", () => {
    expect(wranglerSecretArgs("X", "production", false)).toEqual(["secret", "put", "X"]);
    expect(wranglerSecretArgs("X", "preview", false)).toEqual(["secret", "put", "X", "--env", "preview"]);
    expect(wranglerSecretArgs("X", "staging", true)).toEqual(["versions", "secret", "put", "X", "--env", "staging"]);
  });

  it("falls back to versions secret put when the latest version is not the deployed one", () => {
    const calls: string[][] = [];
    const run: Runner = (_file, args) => {
      calls.push([...args]);
      return args.includes("versions") ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "latest version isn't currently deployed" };
    };
    const item = itemById("auth-secret-preview");
    expect(item && putItem(item, SENTINEL, { run })).toBeUndefined();
    expect(calls.map((args) => args.slice(1, 3))).toEqual([
      ["secret", "put"],
      ["versions", "secret"],
    ]);
  });

  it("passes the account id in the environment, not argv", () => {
    const world = newWorld();
    const item = itemById("auth-secret");
    if (item) putItem(item, SENTINEL, { run: worldRunner(world), accountId: "b".repeat(32) });
    expect(world.calls[0]?.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) });
    expect(world.calls[0]?.args.join(" ")).not.toContain("b".repeat(32));
  });
});

describe("GitHub stores", () => {
  it("puts the production token in the production environment, never a repo-level secret: pull-request jobs can read repo secrets", () => {
    const world = newWorld();
    const item = itemById("production-token");
    if (item) putItem(item, SENTINEL, { run: worldRunner(world) });
    expect(world.ghEnvSecrets.production?.has("CLOUDFLARE_API_TOKEN")).toBe(true);
    expect(world.ghSecrets.has("CLOUDFLARE_API_TOKEN")).toBe(false);
  });

  it("puts the preview token in a repo secret", () => {
    const world = newWorld();
    const item = itemById("preview-token");
    if (item) putItem(item, SENTINEL, { run: worldRunner(world) });
    expect(world.ghSecrets.has("CLOUDFLARE_PREVIEW_API_TOKEN")).toBe(true);
  });

  it("sets the account id as a repo variable through argv words, with no shell", () => {
    const world = newWorld();
    const payload = 'foo"$(touch /tmp/pwned)"';
    const item = itemById("account-id");
    if (item) putItem(item, payload, { run: worldRunner(world) });
    const call = world.calls.find((entry) => entry.args[0] === "variable");
    expect(call?.args).toEqual(["variable", "set", "CLOUDFLARE_ACCOUNT_ID", "--body", payload]);
  });

  it("leaves an existing environment alone: an empty PUT can wipe its reviewers and branch policy", () => {
    const world = newWorld();
    world.environments.add("production");
    expect(ensureGhEnvironment("production", { run: worldRunner(world) })).toBeUndefined();
    expect(world.calls.flatMap((call) => call.args).includes("PUT")).toBe(false);
  });

  it("creates a missing environment (404) with a PUT", () => {
    const world = newWorld();
    expect(ensureGhEnvironment("production", { run: worldRunner(world) })).toBeUndefined();
    expect(world.environments.has("production")).toBe(true);
  });

  it("stops before the secret when the environment cannot be read for another reason", () => {
    const run: Runner = (_file, args) =>
      args[0] === "api" ? { code: 1, stdout: "", stderr: "gh: Forbidden (HTTP 403)" } : { code: 0, stdout: "", stderr: "" };
    const item = itemById("production-token");
    expect(item && putItem(item, SENTINEL, { run })).toMatch(/403/);
  });
});
