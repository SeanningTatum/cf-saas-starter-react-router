import { describe, expect, it } from "vitest";
import type { Outcome } from "../../repo-rules";
import { parseSetupArgs } from "../setup-args";
import { envVarOf, SETUP_ITEMS } from "../setup-items";
import type { Ask } from "../setup-plan";
import { runCheck, runPass, type ReadinessDeps } from "../setup-readiness-run";
import { varsOf, type WranglerConfig } from "../setup-wrangler-vars";
import { everythingSaid, newWorld, worldRunner, type World } from "./helpers/setup-world";

const ACCOUNT = "a".repeat(32);
const VALUES: Record<string, string> = {
  "account-id": ACCOUNT,
  "production-token": "SENTINEL-production-token-000001", // secret-scan: allow secret-assignment
  "preview-token": "SENTINEL-preview-token-0000002",
  "staging-token": "SENTINEL-staging-token-00000003",
  "turnstile-secret-key": "SENTINEL-turnstile-secret-0004",
  "turnstile-site-key": "0x4AAAAAAAsitekey",
  "sentry-dsn": "https://SENTINELdsn5@o1.ingest.sentry.io/6",
  "posthog-key": "SENTINEL-posthog-key-00000007",
  "posthog-host": "https://us.i.posthog.com",
  "auth-url": "https://app.example.com",
  "trusted-origins": "https://*.example.com",
};
const SENTINELS = Object.entries(VALUES)
  .filter(([id, value]) => value.includes("SENTINEL") && id !== "preview-token" && id !== "staging-token")
  .map(([, value]) => value);

const startConfig = (): WranglerConfig => ({
  name: "demo",
  d1_databases: [{ binding: "DATABASE", database_id: "1".repeat(8) }],
  env: { preview: {}, staging: {} },
});

const rulesFor = (world: World) => (): Outcome => {
  world.environments.add("production");
  return { code: 0, stdout: ["ok: rules match"], stderr: [] };
};

const harness = (ask: Ask | undefined = undefined) => {
  const world = newWorld();
  const state = { config: startConfig(), writes: 0, saved: [] as [string, string][] };
  const deps: ReadinessDeps = {
    run: worldRunner(world),
    ask,
    readConfig: () => state.config,
    writeConfig: (next) => {
      state.config = next;
      state.writes += 1;
    },
    applyRules: rulesFor(world),
    generateSecret: () => "g".repeat(64),
    saveLocalEnv: (key, value) => void state.saved.push([key, value]),
    accountId: undefined,
  };
  return { world, state, deps };
};

const request = (argv: string[], env: Record<string, string> = {}) => parseSetupArgs({ argv, env, readStdin: () => "" });

const allByEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    SETUP_ITEMS.filter((item) => item.environment === "production" && VALUES[item.id] !== undefined).map((item) => [envVarOf(item), VALUES[item.id] ?? ""]),
  );

const refusingAsk: Ask = {
  text: async () => {
    throw new Error("asked");
  },
  secret: async () => {
    throw new Error("asked");
  },
  confirm: async () => {
    throw new Error("asked");
  },
  say: () => {},
};

describe("runPass unattended", () => {
  it("asks nothing when every item came by flag or variable, and leaves each required item set", async () => {
    const { deps, world, state } = harness(refusingAsk);
    const env = allByEnvironment();
    const outcome = await runPass(request(["--skip", "preview,staging", "--security"], env), { ...deps, ask: refusingAsk });
    expect(outcome.code).toBe(0);
    expect(world.ghEnvSecrets.production?.has("CLOUDFLARE_API_TOKEN")).toBe(true);
    expect(world.ghVariables.has("CLOUDFLARE_ACCOUNT_ID")).toBe(true);
    expect(world.secrets.production?.has("BETTER_AUTH_SECRET")).toBe(true);
    expect(varsOf(state.config, "production")).toMatchObject({ BETTER_AUTH_URL: VALUES["auth-url"], ERROR_REPORTER: "sentry", ANALYTICS_PROVIDER: "posthog" });
    expect(outcome.lines.join("\n")).not.toMatch(/\bmissing\b.*\(required\)/);
  });

  it("puts no secret in argv, in the environment, in the config file or in anything printed", async () => {
    const { deps, world, state } = harness();
    const outcome = await runPass(request(["--skip", "preview,staging", "--security"], allByEnvironment()), deps);
    const printed = [outcome.lines.join("\n"), everythingSaid(world), JSON.stringify(state.config), JSON.stringify(state.saved)].join("\n");
    for (const sentinel of SENTINELS) {
      expect(printed).not.toContain(sentinel);
      expect(world.calls.some((call) => call.input === sentinel)).toBe(true);
    }
  });

  it("applies the security pass before it sets a deploy token", async () => {
    const { deps, world } = harness();
    await runPass(request(["--skip", "preview,staging", "--security"], allByEnvironment()), deps);
    const firstSecurity = world.calls.findIndex((call) => call.args.includes("PATCH"));
    const tokenPut = world.calls.findIndex((call) => call.args[0] === "secret" && call.args.includes("CLOUDFLARE_API_TOKEN"));
    expect(firstSecurity).toBeGreaterThanOrEqual(0);
    expect(firstSecurity).toBeLessThan(tokenPut);
  });

  it("withholds the production token when the repo rules were not applied", async () => {
    const { deps, world } = harness();
    const failedRules = (): Outcome => ({ code: 1, stdout: [], stderr: ["error: no admin"] });
    const outcome = await runPass(request(["--skip", "all", "--security"], { SETUP_PRODUCTION_TOKEN: VALUES["production-token"] ?? "" }), {
      ...deps,
      applyRules: failedRules,
    });
    expect(world.ghEnvSecrets.production?.has("CLOUDFLARE_API_TOKEN")).toBe(false);
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join("\n")).toMatch(/refused: .*production deploy token was not stored/);
  });

  it("leaves the security settings alone without the flag, and warns when a token went in unprotected", async () => {
    const { deps, world } = harness();
    const outcome = await runPass(request(["--skip", "all"], { SETUP_PRODUCTION_TOKEN: VALUES["production-token"] ?? "" }), deps);
    expect(world.calls.flatMap((call) => call.args).some((arg) => arg === "PATCH")).toBe(false);
    expect(outcome.lines.join("\n")).toMatch(/required reviewer/);
  });
});

describe("a re-run changes only what it is asked to change (#144)", () => {
  it("adds one skipped item and keeps every variable and secret already set", async () => {
    const { deps, world, state } = harness();
    await runPass(request(["--skip", "preview,staging,errors"], allByEnvironment()), deps);
    const before = JSON.stringify(varsOf(state.config, "production"));
    const callsBefore = world.calls.length;
    const outcome = await runPass(request(["--skip", "preview,staging"], { SETUP_SENTRY_DSN: VALUES["sentry-dsn"] ?? "", SETUP_AUTH_SECRET: "" }), {
      ...deps,
      ask: undefined,
    });
    const added = world.calls.slice(callsBefore).filter((call) => call.input !== undefined || call.args.includes("PUT") || call.args.includes("PATCH"));
    expect(added.map((call) => call.args.join(" "))).toContain("wrangler secret put SENTRY_DSN");
    expect(added.every((call) => call.args.includes("SENTRY_DSN"))).toBe(true);
    expect(varsOf(state.config, "production")).toEqual({ ...JSON.parse(before), ERROR_REPORTER: "sentry" });
    expect(outcome.code).toBe(0);
  });

  it("does not write the config at all when no variable is named", async () => {
    const { deps, state } = harness();
    await runPass(request(["--skip", "all"], { SETUP_PRODUCTION_TOKEN: VALUES["production-token"] ?? "" }), deps);
    expect(state.writes).toBe(0);
  });

  it("does not replace an auth secret that already exists", async () => {
    const { deps, world } = harness();
    world.secrets.production?.add("BETTER_AUTH_SECRET");
    await runPass(request(["--yes", "--skip", "deploy,auth-url,trusted-origins"]), deps);
    expect(world.calls.some((call) => call.args.includes("BETTER_AUTH_SECRET") && call.args.includes("put") && !call.args.includes("preview"))).toBe(false);
  });

  it("refuses half a Turnstile pair and exits non-zero", async () => {
    const { deps, world } = harness();
    const outcome = await runPass(request(["--skip", "all", "--turnstile-site-key", VALUES["turnstile-site-key"] ?? ""]), deps);
    expect(outcome.code).toBe(1);
    expect(outcome.lines.join("\n")).toMatch(/refused: .*turnstile-secret-key/);
    expect(world.secrets.production?.has("TURNSTILE_SECRET_KEY")).toBe(false);
  });
});

describe("a fork that skips everything", () => {
  it("changes nothing except an auth secret, and reports every optional item as skipped", async () => {
    const { deps, state } = harness();
    const outcome = await runPass(request(["--yes"]), deps);
    expect(state.writes).toBe(0);
    expect(outcome.lines.join("\n")).toMatch(/Sentry DSN\)\s+production\s+skipped/);
  });
});

describe("runCheck", () => {
  it("prints the table and exits 1 while a required item is missing", () => {
    const { deps } = harness();
    const outcome = runCheck(deps);
    expect(outcome.code).toBe(1);
    expect(outcome.lines[0]).toMatch(/^item\s+env\s+status\s+set it with/);
  });

  it("exits 0 once the required items are set, and reads only names", async () => {
    const { deps, world } = harness();
    await runPass(request(["--skip", "preview,staging"], allByEnvironment()), deps);
    const callsBefore = world.calls.length;
    const outcome = runCheck(deps);
    expect(outcome.code).toBe(0);
    const reads = world.calls.slice(callsBefore);
    expect(reads.every((call) => call.input === undefined)).toBe(true);
    expect(reads.some((call) => ["put", "set", "PUT", "PATCH"].some((verb) => call.args.includes(verb)))).toBe(false);
    for (const sentinel of SENTINELS) expect(outcome.lines.join("\n")).not.toContain(sentinel);
  });
});
