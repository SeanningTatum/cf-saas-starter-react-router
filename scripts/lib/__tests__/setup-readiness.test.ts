import { describe, expect, it } from "vitest";
import { commandFor, evaluate, exitCodeOf, isSet, readSnapshot, renderTable, type Row, type Status } from "../setup-readiness";
import { itemById, SETUP_ITEMS } from "../setup-items";
import type { WranglerConfig } from "../setup-wrangler-vars";
import { newWorld, worldRunner } from "./helpers/setup-world";

const config: WranglerConfig = { vars: { BETTER_AUTH_URL: "https://app.example.com" }, env: { preview: {}, staging: {} } };

const statusOf = (rows: ReadonlyArray<Row>, id: string): Status | undefined => rows.find((row) => row.item.id === id)?.status;

const readyWorld = () => {
  const world = newWorld();
  world.secrets.production?.add("BETTER_AUTH_SECRET");
  world.ghVariables.add("CLOUDFLARE_ACCOUNT_ID");
  world.ghEnvSecrets.production?.add("CLOUDFLARE_API_TOKEN");
  return world;
};

describe("evaluate", () => {
  it("shows an item as set, missing or skipped", () => {
    const rows = evaluate(readSnapshot(worldRunner(readyWorld()), { ...config }));
    expect(statusOf(rows, "auth-url")).toBe("set");
    expect(statusOf(rows, "production-token")).toBe("set");
    expect(statusOf(rows, "sentry-dsn")).toBe("skipped");
    const world = readyWorld();
    world.ghVariables.clear();
    expect(statusOf(evaluate(readSnapshot(worldRunner(world), config)), "account-id")).toBe("missing");
  });

  it("exits 0 when every required item is set, and 1 when one is missing", () => {
    expect(exitCodeOf(evaluate(readSnapshot(worldRunner(readyWorld()), config)))).toBe(0);
    const world = readyWorld();
    world.ghEnvSecrets.production?.clear();
    expect(exitCodeOf(evaluate(readSnapshot(worldRunner(world), config)))).toBe(1);
  });

  it("calls a required item unread, not set, when its store cannot be read", () => {
    const world = readyWorld();
    world.ghWorks = false;
    const rows = evaluate(readSnapshot(worldRunner(world), config));
    expect(statusOf(rows, "production-token")).toBe("unread");
    expect(statusOf(rows, "preview-token")).toBe("skipped");
    expect(exitCodeOf(rows)).toBe(1);
  });

  it("treats a lone Turnstile key as missing: auth refuses to start with half a pair", () => {
    const world = readyWorld();
    world.secrets.production?.add("TURNSTILE_SECRET_KEY");
    const rows = evaluate(readSnapshot(worldRunner(world), config));
    expect(statusOf(rows, "turnstile-site-key")).toBe("missing");
    expect(exitCodeOf(rows)).toBe(1);
  });

  it("reads names only: the commands it runs list names and ask for no value", () => {
    const world = readyWorld();
    readSnapshot(worldRunner(world), config);
    for (const call of world.calls) {
      expect(call.input).toBeUndefined();
      expect(call.args.some((arg) => ["put", "set", "PUT", "PATCH"].includes(arg))).toBe(false);
    }
    const ghLists = world.calls.filter((call) => call.file === "gh");
    expect(ghLists.every((call) => call.args.includes("--json") && call.args.includes("name"))).toBe(true);
  });

  it("says what sets each missing item and never a value", () => {
    const secret = itemById("production-token");
    const plain = itemById("auth-url");
    expect(secret && commandFor(secret)).toBe("bun run setup --production-token=-  (or SETUP_PRODUCTION_TOKEN=...)");
    expect(plain && commandFor(plain)).toBe("bun run setup --auth-url <value>");
  });

  it("prints one row per item with its status and command", () => {
    const rows = evaluate(readSnapshot(worldRunner(newWorld()), null));
    const lines = renderTable(rows);
    expect(lines).toHaveLength(SETUP_ITEMS.length + 1);
    expect(lines.join("\n")).toMatch(/Production deploy token\s+production\s+missing\s+bun run setup --production-token=-/);
    expect(lines.join("\n")).toContain("(required)");
  });

  it("answers isSet from the right store", () => {
    const snapshot = readSnapshot(worldRunner(readyWorld()), config);
    const url = itemById("auth-url");
    const dsn = itemById("sentry-dsn");
    expect(url && isSet(url, snapshot)).toBe(true);
    expect(dsn && isSet(dsn, snapshot)).toBe(false);
  });
});
