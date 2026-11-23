import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  deployArgv,
  parseSoleVersion,
  parseVersionId,
  planRollout,
  run,
  spawnCaptured,
  trafficSpecs,
  uploadArgv,
  type CommandResult,
  type Deps,
  type RolloutOptions,
} from "../rollout";
import type { HttpAnswer } from "../smoke-check";

const OLD = "11111111-1111-4111-8111-111111111111";
const NEW = "22222222-2222-4222-8222-222222222222";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const RELEASE = "v3.1.0";
const ORIGIN = "https://app.example.com";
const WRANGLER = '// header\n{ "name": "my-app" }\n';

const ok = (output = ""): CommandResult => ({ status: 0, output, timedOut: false });
const failed = (output = ""): CommandResult => ({ status: 1, output, timedOut: false });
const statusOutput = (versions: { version_id: string; percentage: number }[]) => `⛅️ wrangler 4.69.0\n${JSON.stringify({ id: "d1", versions }, null, 2)}\n`;
const UPLOAD_OUTPUT = `Total Upload: 1200 KiB\nUploaded my-app (3.1 sec)\nWorker Version ID: ${NEW}\n`;
const healthy = (release = RELEASE): HttpAnswer => ({ status: 200, body: JSON.stringify({ status: "up", release }) });
const broken: HttpAnswer = { status: 503, body: JSON.stringify({ status: "down", release: RELEASE }) };
const FAST: RolloutOptions = { soakMs: 30_000, smoke: { attempts: 2, delayMs: 5_000, timeoutMs: 1_000 }, steps: [10, 50, 100] };

interface Fake {
  status?: CommandResult | ((call: number) => CommandResult);
  upload?: CommandResult;
  deploy?: (specs: string[]) => CommandResult;
  health?: (call: number, headers: Readonly<Record<string, string>>) => HttpAnswer | undefined;
  env?: Record<string, string | undefined>;
  wrangler?: string | undefined;
}

function harness(fake: Fake = {}) {
  const commands: string[][] = [];
  const deploys: string[][] = [];
  const logs: string[] = [];
  const files: Record<string, string> = {};
  const sleeps: number[] = [];
  const pins: string[] = [];
  let healthCalls = 0;
  let statusCalls = 0;
  const deps: Deps = {
    env: {
      RELEASE_VERSION: RELEASE,
      DEPLOY_SHA: SHA,
      PRODUCTION_URL: ORIGIN,
      GITHUB_STEP_SUMMARY: "summary",
      GITHUB_OUTPUT: "output",
      ...fake.env,
    },
    runCommand: (argv) => {
      const args = argv.slice(2);
      commands.push(args);
      if (args[0] === "deployments") {
        statusCalls += 1;
        const status = typeof fake.status === "function" ? fake.status(statusCalls) : fake.status;
        return status ?? ok(statusOutput([{ version_id: OLD, percentage: 100 }]));
      }
      if (args[1] === "upload") return fake.upload ?? ok(UPLOAD_OUTPUT);
      const specs = args.slice(2, args.indexOf("--message"));
      deploys.push(specs);
      return fake.deploy ? fake.deploy(specs) : ok();
    },
    appendFile: (file, text) => {
      files[file] = (files[file] ?? "") + text;
    },
    readFile: () => ("wrangler" in fake ? fake.wrangler : WRANGLER),
    wranglerPath: "wrangler.jsonc",
    fetch: (_url, headers) => {
      healthCalls += 1;
      pins.push(headers["Cloudflare-Workers-Version-Overrides"] ?? "");
      return Promise.resolve(fake.health ? fake.health(healthCalls, headers) : healthy());
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    log: (line) => logs.push(line),
  };
  const output = () =>
    Object.fromEntries(
      (files.output ?? "")
        .trim()
        .split("\n")
        .map((line) => line.split("=") as [string, string]),
    );
  return { deps, commands, deploys, logs, files, sleeps, pins, output, healthCalls: () => healthCalls };
}

describe("planRollout", () => {
  it("steps through 10, 50 and 100 with a check after each when there is a live version and a URL, so that a bad version reaches a tenth of users first", () => {
    expect(planRollout(true, true, [10, 50, 100])).toEqual({ steps: [10, 50, 100], checked: true });
  });

  it("always ends at 100 even when the steps leave it out, so that a rollout never stops at a split", () => {
    expect(planRollout(true, true, [25, 50]).steps).toEqual([25, 50, 100]);
  });

  it("goes straight to 100 on the first deploy, checked, and with no URL, unchecked, so that there is never a split with nothing to split with or nothing to judge it", () => {
    expect(planRollout(false, true)).toEqual({ steps: [100], checked: true });
    expect(planRollout(true, false)).toEqual({ steps: [100], checked: false });
  });
});

describe("traffic and parsing", () => {
  it("splits traffic so the two shares add up to 100, and names only the new version at 100, so that wrangler is never asked for a split it refuses", () => {
    expect(trafficSpecs(NEW, OLD, 10)).toEqual([`${NEW}@10%`, `${OLD}@90%`]);
    expect(trafficSpecs(NEW, OLD, 100)).toEqual([`${NEW}@100%`]);
    expect(trafficSpecs(NEW, undefined, 10)).toEqual([`${NEW}@100%`]);
  });

  it("reads the version id from the upload output and nothing from output without one, so that a changed wrangler format stops the deploy instead of deploying a guess", () => {
    expect(parseVersionId(UPLOAD_OUTPUT)).toBe(NEW);
    expect(parseVersionId("Uploaded my-app\n")).toBeUndefined();
  });

  it("takes a version as the way back only when it serves 100% alone, so that a split left by a failed run never makes a bad version the rollback target", () => {
    expect(parseSoleVersion(statusOutput([{ version_id: OLD, percentage: 100 }]))).toEqual(Either.right(OLD));
    const split = parseSoleVersion(
      statusOutput([
        { version_id: NEW, percentage: 10 },
        { version_id: OLD, percentage: 90 },
      ]),
    );
    expect(Either.isLeft(split) && split.left).toContain("does not send 100% of traffic to one version");
    expect(Either.isLeft(parseSoleVersion("not json"))).toBe(true);
    expect(Either.isLeft(parseSoleVersion(statusOutput([{ version_id: "not-a-uuid", percentage: 100 }])))).toBe(true);
  });

  it("uploads with the release and the production environment and deploys with --yes and a message, so that error reports name the release and no prompt hangs the job", () => {
    expect(uploadArgv(RELEASE, "0123456")).toEqual(
      expect.arrayContaining(["versions", "upload", `RELEASE_VERSION:${RELEASE}`, "ENVIRONMENT:production", "--message"]),
    );
    expect(deployArgv([`${NEW}@10%`, `${OLD}@90%`], "m").slice(2)).toEqual(["versions", "deploy", `${NEW}@10%`, `${OLD}@90%`, "--message", "m", "--yes"]);
  });
});

describe("run: a healthy release", () => {
  it("uploads, then moves 10, 50 and 100 percent with a soak and a pinned smoke check after each, and exits 0, so that a good release reaches everyone", async () => {
    const h = harness();
    expect(await run(h.deps, FAST)).toBe(0);
    expect(h.deploys).toEqual([[`${NEW}@10%`, `${OLD}@90%`], [`${NEW}@50%`, `${OLD}@50%`], [`${NEW}@100%`]]);
    expect(h.sleeps.filter((ms) => ms === FAST.soakMs)).toHaveLength(3);
    expect(new Set(h.pins)).toEqual(new Set([`my-app="${NEW}"`]));
    expect(h.output()).toMatchObject({ outcome: "promoted", version_id: NEW, previous_version_id: OLD, failed_at: "" });
    expect(h.files.summary).toContain("100%: smoke check passed");
  });

  it("reads the current deployment before it uploads, so that the version to go back to is known before anything changes", async () => {
    const h = harness();
    await run(h.deps, FAST);
    expect(h.commands[0]?.slice(0, 2)).toEqual(["deployments", "status"]);
    expect(h.commands[1]?.slice(0, 2)).toEqual(["versions", "upload"]);
  });
});

describe("run: automatic rollback", () => {
  it("sends all traffic back to the old version when the check fails at 10%, exits 1 and says so, so that a broken release is undone without a person", async () => {
    const h = harness({ health: () => broken });
    expect(await run(h.deps, FAST)).toBe(1);
    expect(h.deploys).toEqual([[`${NEW}@10%`, `${OLD}@90%`], [`${OLD}@100%`]]);
    expect(h.output()).toMatchObject({ outcome: "rolled-back", failed_at: "10", previous_version_id: OLD });
    expect(h.logs.some((line) => line.startsWith("::error::The smoke check failed at 10%"))).toBe(true);
    expect(h.files.summary).toContain("Failed at: 10%");
  });

  it("rolls back from 50% when the first check passed and the second fails, so that a fault that shows under more traffic is caught", async () => {
    const h = harness({ health: (call) => (call <= 1 ? healthy() : broken) });
    expect(await run(h.deps, FAST)).toBe(1);
    expect(h.deploys.at(-1)).toEqual([`${OLD}@100%`]);
    expect(h.output()).toMatchObject({ outcome: "rolled-back", failed_at: "50" });
  });

  it("fails the check when the old release answers through an ignored pin, so that a pin Cloudflare dropped never passes the new version", async () => {
    const h = harness({ health: () => healthy("v3.0.9") });
    expect(await run(h.deps, FAST)).toBe(1);
    expect(h.output()).toMatchObject({ outcome: "rolled-back", failed_at: "10" });
  });

  it("rolls back when wrangler cannot move traffic to a step, so that a half-applied split is not left behind", async () => {
    const h = harness({ deploy: (specs) => (specs[0]?.startsWith(NEW) && specs[0] !== `${NEW}@10%` ? failed() : ok()) });
    expect(await run(h.deps, FAST)).toBe(1);
    expect(h.deploys.at(-1)).toEqual([`${OLD}@100%`]);
    expect(h.output()).toMatchObject({ outcome: "rolled-back", failed_at: "50" });
  });

  it("reports the rollback as failed when wrangler says it worked but the deployment still splits, so that a late traffic move cannot be hidden behind a success", async () => {
    const split = ok(
      statusOutput([
        { version_id: NEW, percentage: 10 },
        { version_id: OLD, percentage: 90 },
      ]),
    );
    const h = harness({ health: () => broken, status: (call) => (call === 1 ? ok(statusOutput([{ version_id: OLD, percentage: 100 }])) : split) });
    expect(await run(h.deps, FAST)).toBe(1);
    expect(h.output()).toMatchObject({ outcome: "rollback-failed" });
  });

  it("names the old version and the command to run when the rollback itself fails, so that a person can finish it at once", async () => {
    const h = harness({ health: () => broken, deploy: (specs) => (specs[0] === `${OLD}@100%` ? failed() : ok()) });
    expect(await run(h.deps, FAST)).toBe(1);
    expect(h.output()).toMatchObject({ outcome: "rollback-failed" });
    expect(h.logs.join("\n")).toContain(`bunx wrangler versions deploy ${OLD}@100% -y`);
  });
});

describe("run: first deploy, no URL and bad input", () => {
  it("goes to 100% at once on a Worker with no deployment, checks it, and fails without a rollback when the check fails, so that the first deploy is judged but never 'rolled back' to nothing", async () => {
    const h = harness({ status: failed("✘ [ERROR] The Worker my-app has no deployments."), health: () => broken });
    expect(await run(h.deps, FAST)).toBe(1);
    expect(h.deploys).toEqual([[`${NEW}@100%`]]);
    expect(h.output()).toMatchObject({ outcome: "failed", previous_version_id: "" });
    expect(h.logs.some((line) => line.includes("has no deployment yet"))).toBe(true);
  });

  it("goes to 100% with a warning and no check when PRODUCTION_URL is unset, so that a repo not set up for checks still deploys as it did before", async () => {
    const h = harness({ env: { PRODUCTION_URL: undefined } });
    expect(await run(h.deps, FAST)).toBe(0);
    expect(h.deploys).toEqual([[`${NEW}@100%`]]);
    expect(h.healthCalls()).toBe(0);
    expect(h.logs.some((line) => line.startsWith("::warning::The PRODUCTION_URL variable is not set"))).toBe(true);
  });

  it("uploads nothing when the release, the Worker name or the URL is bad, or the current deployment cannot be read, so that a broken input never reaches production", async () => {
    for (const fake of [
      { env: { RELEASE_VERSION: "" } },
      { env: { RELEASE_VERSION: "v1\n::error::x" } },
      { env: { PRODUCTION_URL: "http://app.example.com" } },
      { wrangler: undefined },
      { wrangler: '{ "name": "My App" }' },
      { status: failed("Authentication error [code: 10000]") },
      { status: ok("nothing here") },
      {
        status: ok(
          statusOutput([
            { version_id: NEW, percentage: 50 },
            { version_id: OLD, percentage: 50 },
          ]),
        ),
      },
    ] satisfies Fake[]) {
      const h = harness(fake);
      expect(await run(h.deps, FAST), JSON.stringify(fake)).toBe(1);
      expect(h.commands.some((args) => args[1] === "upload")).toBe(false);
    }
  });

  it("deploys nothing when the upload fails or prints no version id, so that production keeps the version it runs", async () => {
    for (const upload of [failed(), ok("Uploaded my-app\n")]) {
      const h = harness({ upload });
      expect(await run(h.deps, FAST)).toBe(1);
      expect(h.deploys).toEqual([]);
    }
  });
});

describe("spawnCaptured", () => {
  it("returns the exit status and both output streams, and an empty failure for an empty argv, so that a wrangler error on stderr can be read", () => {
    const result = spawnCaptured(["node", "-e", "process.stdout.write('out ');process.stderr.write('has no deployments');process.exit(3)"], 10_000);
    expect(result.status).toBe(3);
    expect(result.output).toContain("has no deployments");
    expect(spawnCaptured([], 1_000)).toEqual({ status: 1, output: "", timedOut: false });
  });
});
