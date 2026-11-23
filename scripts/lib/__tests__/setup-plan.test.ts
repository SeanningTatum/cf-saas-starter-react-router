import { describe, expect, it } from "vitest";
import { parseSetupArgs } from "../setup-args";
import { buildPlan, type Ask } from "../setup-plan";
import { readSnapshot } from "../setup-readiness";
import { newWorld, worldRunner } from "./helpers/setup-world";

const URL_VALUE = "https://app.example.com";
const TOKEN = "tok-prod-AAAAAAAAAAAAAAAAAAAA";
const KEY = "0x4AAAAAAAreal-key";

const request = (argv: string[], env: Record<string, string> = {}) => parseSetupArgs({ argv, env, readStdin: () => "" });

const snapshotOf = (configure: (world: ReturnType<typeof newWorld>) => void = () => {}) => {
  const world = newWorld();
  configure(world);
  return readSnapshot(worldRunner(world), { env: { preview: {}, staging: {} } });
};

const base = { generateSecret: () => "g".repeat(64), detectedAccountId: undefined };

const scripted = (answers: Record<string, string | boolean>): { ask: Ask; asked: string[] } => {
  const asked: string[] = [];
  const reply = (label: string) => {
    asked.push(label);
    const key = Object.keys(answers).find((part) => label.includes(part));
    return key === undefined ? undefined : answers[key];
  };
  const ask: Ask = {
    text: async (label) => reply(label) as string | undefined,
    secret: async (label) => reply(label) as string | undefined,
    confirm: async (label, initial) => (reply(label) as boolean | undefined) ?? initial,
    say: () => {},
  };
  return { ask, asked };
};

describe("buildPlan from flags", () => {
  it("plans exactly the items given, and asks nothing", async () => {
    const plan = await buildPlan({ ...base, request: request(["--auth-url", URL_VALUE, "--skip", "all"]), snapshot: snapshotOf(), ask: undefined });
    expect(plan.entries.map((entry) => [entry.item.id, entry.source])).toEqual([["auth-url", "flag"]]);
  });

  it("generates the auth secret for production and preview when missing, never for staging", async () => {
    const plan = await buildPlan({ ...base, request: request(["--skip", "all"]), snapshot: snapshotOf(), ask: undefined });
    expect(plan.entries).toEqual([]);
    const open = await buildPlan({ ...base, request: request(["--yes"]), snapshot: snapshotOf(), ask: undefined });
    expect(open.entries.map((entry) => entry.item.id).sort()).toEqual(["auth-secret", "auth-secret-preview"]);
  });

  it("keeps an auth secret that is already set unless it is told to rotate it: a new one logs every user out", async () => {
    const set = (world: ReturnType<typeof newWorld>) => world.secrets.production?.add("BETTER_AUTH_SECRET");
    const kept = await buildPlan({ ...base, request: request(["--yes"]), snapshot: snapshotOf(set), ask: undefined });
    expect(kept.entries.map((entry) => entry.item.id)).not.toContain("auth-secret");
    expect(kept.kept.map((item) => item.id)).toContain("auth-secret");
    const rotated = await buildPlan({ ...base, request: request(["--yes", "--rotate-auth-secret"]), snapshot: snapshotOf(set), ask: undefined });
    expect(rotated.entries.map((entry) => entry.item.id)).toContain("auth-secret");
  });

  it("changes an item that is already set when a flag names it", async () => {
    const set = (world: ReturnType<typeof newWorld>) => world.ghEnvSecrets.production?.add("CLOUDFLARE_API_TOKEN");
    const plan = await buildPlan({
      ...base,
      request: request([], { SETUP_PRODUCTION_TOKEN: TOKEN, SETUP_AUTH_SECRET: "" }),
      snapshot: snapshotOf(set),
      ask: undefined,
    });
    expect(plan.entries.find((entry) => entry.item.id === "production-token")?.value).toBe(TOKEN);
  });

  it("takes the detected account id once, and never over a flag or a value already set", async () => {
    const detected = { ...base, detectedAccountId: "c".repeat(32), ask: undefined };
    const plan = await buildPlan({ ...detected, request: request(["--yes"]), snapshot: snapshotOf() });
    expect(plan.entries.find((entry) => entry.item.id === "account-id")?.source).toBe("detected");
    const set = await buildPlan({ ...detected, request: request(["--yes"]), snapshot: snapshotOf((world) => world.ghVariables.add("CLOUDFLARE_ACCOUNT_ID")) });
    expect(set.entries.map((entry) => entry.item.id)).not.toContain("account-id");
  });

  it("refuses half a Turnstile pair in one run, and accepts it when the other half is already set", async () => {
    const lone = await buildPlan({ ...base, request: request(["--turnstile-site-key", KEY, "--skip", "all"]), snapshot: snapshotOf(), ask: undefined });
    expect(lone.entries).toEqual([]);
    expect(lone.problems.join("")).toMatch(/--turnstile-secret-key/);
    const paired = await buildPlan({
      ...base,
      request: request(["--turnstile-site-key", KEY, "--skip", "all"]),
      snapshot: snapshotOf((world) => world.secrets.production?.add("TURNSTILE_SECRET_KEY")),
      ask: undefined,
    });
    expect(paired.entries.map((entry) => entry.item.id)).toEqual(["turnstile-site-key"]);
    expect(paired.problems).toEqual([]);
  });
});

describe("buildPlan by prompt", () => {
  it("asks only for what is unset, unskipped and in scope, and takes a blank answer as a skip", async () => {
    const { ask, asked } = scripted({ "Auth URL": URL_VALUE, "Trusted origins": "" });
    const plan = await buildPlan({ ...base, request: request(["--skip", "deploy,turnstile,errors,analytics"]), snapshot: snapshotOf(), ask });
    expect(plan.entries.filter((entry) => entry.source === "prompt").map((entry) => entry.item.id)).toEqual(["auth-url"]);
    expect(asked.join("\n")).not.toMatch(/\((preview|staging)\)|Turnstile key|Sentry DSN/);
  });

  it("asks for preview and staging only when told to", async () => {
    const { ask, asked } = scripted({ "Also set preview": true, "Auth URL (preview)": URL_VALUE });
    const plan = await buildPlan({ ...base, request: request(["--skip", "deploy,turnstile,errors,analytics,production"]), snapshot: snapshotOf(), ask });
    expect(asked.some((label) => label.includes("(preview)"))).toBe(true);
    expect(plan.entries.map((entry) => entry.item.id)).toContain("auth-url-preview");
  });

  it("does not ask about an item already set", async () => {
    const { ask, asked } = scripted({});
    await buildPlan({ ...base, request: request(["--skip", "deploy,turnstile,errors,analytics"]), snapshot: snapshotOf(), ask });
    expect(asked.some((label) => label.includes("Auth URL (production)"))).toBe(true);
    const withUrl = scripted({});
    await buildPlan({
      ...base,
      request: request(["--skip", "deploy,turnstile,errors,analytics"]),
      snapshot: readSnapshot(worldRunner(newWorld()), { vars: { BETTER_AUTH_URL: URL_VALUE } }),
      ask: withUrl.ask,
    });
    expect(withUrl.asked.some((label) => label.includes("Auth URL (production)"))).toBe(false);
  });

  it("asks again after a refused answer and gives up after three", async () => {
    let calls = 0;
    const ask: Ask = {
      text: async () => {
        calls += 1;
        return "not a url";
      },
      secret: async () => undefined,
      confirm: async (_label, initial) => initial,
      say: () => {},
    };
    const plan = await buildPlan({ ...base, request: request(["--skip", "deploy,turnstile,errors,analytics"]), snapshot: snapshotOf(), ask });
    expect(plan.entries.filter((entry) => entry.source === "prompt")).toEqual([]);
    expect(calls).toBe(6);
  });

  it("asks nothing when every item came by flag, or --yes is set", async () => {
    const { ask, asked } = scripted({});
    await buildPlan({ ...base, request: request(["--skip", "all"]), snapshot: snapshotOf(), ask });
    await buildPlan({ ...base, request: request(["--yes"]), snapshot: snapshotOf(), ask });
    expect(asked).toEqual([]);
  });
});
