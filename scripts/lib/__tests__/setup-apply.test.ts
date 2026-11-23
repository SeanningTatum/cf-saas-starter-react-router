import { describe, expect, it } from "vitest";
import { applyPlan, describeApplied } from "../setup-apply";
import { itemById, type SetupItem } from "../setup-items";
import type { Entry, Plan } from "../setup-plan";
import { readSnapshot } from "../setup-readiness";
import { varsOf, type WranglerConfig } from "../setup-wrangler-vars";
import { everythingSaid, newWorld, worldRunner } from "./helpers/setup-world";

const SENTINEL = "SENTINEL-value-0123456789abcdefghij";
const SEED = "s".repeat(32);
const config: WranglerConfig = { name: "x", vars: { KEEP: "yes" }, env: { preview: {}, staging: {} } };

const entry = (id: string, value: string, source: Entry["source"] = "flag"): Entry => {
  const item = itemById(id) as SetupItem;
  return { item, value, source };
};

const plan = (...entries: Entry[]): Plan => ({ entries, kept: [], problems: [] });

const setup = (configured: WranglerConfig | null = config, existing: Set<string> = new Set()) => {
  const world = newWorld();
  const written: WranglerConfig[] = [];
  const saved: [string, string][] = [];
  const before = newWorld();
  for (const name of existing) before.ghSecrets.add(name);
  const deps = {
    context: { run: worldRunner(world) },
    config: configured,
    writeConfig: (next: WranglerConfig) => void written.push(next),
    generateSecret: () => SEED,
    saveLocalEnv: (key: string, value: string) => void saved.push([key, value]),
    snapshot: readSnapshot(worldRunner(before), configured),
  };
  return { world, written, saved, deps };
};

describe("applyPlan", () => {
  it("writes a variable into the file and keeps the others", () => {
    const { deps, written } = setup();
    const outcome = applyPlan(plan(entry("auth-url", "https://app.example.com"), entry("auth-url-preview", "https://p.example.com")), deps);
    expect(outcome.varsChanged).toBe(true);
    expect(outcome.applied.every((applied) => applied.error === undefined)).toBe(true);
    const [next] = written;
    expect(varsOf(next ?? null, "production")).toEqual({ KEEP: "yes", BETTER_AUTH_URL: "https://app.example.com" });
    expect(varsOf(next ?? null, "preview")).toEqual({ BETTER_AUTH_URL: "https://p.example.com" });
  });

  it("turns a service on with its companion variable when its key goes in", () => {
    const { deps, written, world } = setup();
    applyPlan(plan(entry("sentry-dsn", "https://abc@o1.ingest.sentry.io/42")), deps);
    expect(varsOf(written[0] ?? null, "production").ERROR_REPORTER).toBe("sentry");
    expect(world.secrets.production?.has("SENTRY_DSN")).toBe(true);
  });

  it("puts no secret in the config file or in any command word", () => {
    const { deps, written, world } = setup();
    const secrets = ["production-token", "preview-token", "turnstile-secret-key", "sentry-dsn", "posthog-key", "auth-secret"].map((id) => entry(id, SENTINEL));
    applyPlan(plan(entry("auth-url", "https://app.example.com"), ...secrets), deps);
    expect(JSON.stringify(written)).not.toContain(SENTINEL);
    expect(everythingSaid(world)).not.toContain(SENTINEL);
    expect(world.calls.filter((call) => call.input === SENTINEL).length).toBeGreaterThanOrEqual(secrets.length);
  });

  it("changes nothing in the file when no variable is planned", () => {
    const { deps, written } = setup();
    expect(applyPlan(plan(entry("production-token", SENTINEL)), deps).varsChanged).toBe(false);
    expect(written).toEqual([]);
  });

  it("reports an environment with no block instead of writing it", () => {
    const { deps, written } = setup({ name: "x" });
    const outcome = applyPlan(plan(entry("auth-url-staging", "https://s.example.com")), deps);
    expect(outcome.applied[0]?.error).toMatch(/no staging block/);
    expect(written).toEqual([]);
  });

  it("reports an unreadable config", () => {
    const { deps } = setup(null);
    expect(applyPlan(plan(entry("auth-url", "https://app.example.com")), deps).applied[0]?.error).toMatch(/cannot be read/);
  });

  it("sets the preview seed secret with the preview token, saves it to .env and keeps it out of argv", () => {
    const { deps, world, saved } = setup();
    const outcome = applyPlan(plan(entry("preview-token", SENTINEL)), deps);
    expect(world.ghSecrets.has("PREVIEW_SEED_SECRET")).toBe(true);
    expect(saved).toEqual([["PREVIEW_SEED_SECRET", SEED]]);
    expect(everythingSaid(world)).not.toContain(SEED);
    expect(outcome.notes.join("\n")).not.toContain(SEED);
  });

  it("leaves a seed secret that already exists: a new one would change every preview password", () => {
    const { deps, saved } = setup(config, new Set(["PREVIEW_SEED_SECRET"]));
    applyPlan(plan(entry("preview-token", SENTINEL)), deps);
    expect(saved).toEqual([]);
  });
});

describe("applyPlan when an upload fails", () => {
  it("keeps the Turnstile site key out of the file when the secret key did not upload", () => {
    const { deps, written, world } = setup();
    world.failing.add("TURNSTILE_SECRET_KEY");
    const outcome = applyPlan(plan(entry("turnstile-site-key", "0x4AAAAAAAsite"), entry("turnstile-secret-key", SENTINEL)), deps);
    expect(written).toEqual([]);
    expect(outcome.varsChanged).toBe(false);
    expect(outcome.applied.every((applied) => applied.error !== undefined)).toBe(true);
  });

  it("reports a missing environment block on a service whose secret went in", () => {
    const { deps } = setup({ name: "x" });
    const outcome = applyPlan(plan(entry("sentry-dsn-staging", "https://abc@o1.ingest.sentry.io/42")), deps);
    expect(outcome.applied[0]?.error).toMatch(/no staging block/);
  });

  it("sets no companion variable when the secret did not upload", () => {
    const { deps, written, world } = setup();
    world.failing.add("SENTRY_DSN");
    const outcome = applyPlan(plan(entry("sentry-dsn", "https://abc@o1.ingest.sentry.io/42")), deps);
    expect(written).toEqual([]);
    expect(outcome.applied[0]?.error).toBeDefined();
  });

  it("retries the preview seed on a plain re-run when the token is already set and the seed is not", () => {
    const { deps, saved } = setup(config, new Set(["CLOUDFLARE_PREVIEW_API_TOKEN"]));
    const outcome = applyPlan(plan(), deps);
    expect(saved).toEqual([["PREVIEW_SEED_SECRET", SEED]]);
    expect(outcome.notes.join("\n")).toMatch(/PREVIEW_SEED_SECRET set/);
  });
});

describe("describeApplied", () => {
  it("names the item and the environment and never a value", () => {
    const line = describeApplied({ item: itemById("auth-url-preview") as SetupItem, source: "flag", error: undefined });
    expect(line).toBe("ok: Auth URL (preview) set");
    expect(describeApplied({ item: itemById("auth-secret") as SetupItem, source: "generated", error: "boom" })).toBe("failed: Auth secret: boom");
  });
});
