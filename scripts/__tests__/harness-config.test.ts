import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { defaultDeps, run, type Deps } from "../harness-config";
import {
  CONFIG_KEYS,
  HARNESS_DEFAULTS,
  HARNESS_ROOT,
  NESTED_KEYS,
  configChecksum,
  loadHarnessConfig,
  loadHarnessConfigFromDisk,
  shownConfig,
  stableJson,
  type HarnessConfig,
} from "../lib/harness-config";
import { CONFIG_FILE_NAME } from "../lib/harness-config-constants";
import { ledgerChecksum } from "../lib/run-telemetry";
import { readConfig } from "../../.claude/workflow-src/lib.js";
import { FIXTURE_ROLE_EMAILS } from "../../app/lib/constants/fixtures";
import { LOCAL_FIXTURE_PASSWORD } from "../lib/seed-constants";

const ROOT = "/repo";

const depsWith = (file: string | null): Deps => ({ root: ROOT, readFile: (path) => (path === join(ROOT, CONFIG_FILE_NAME) ? file : null) });

const load = (file: string | null) => loadHarnessConfig(depsWith(file));

const loadedOrThrow = (file: string | null): HarnessConfig => {
  const result = load(file);
  if (Either.isLeft(result)) throw new Error(result.left);
  return result.right;
};

const faultOf = (file: string): string => {
  const result = load(file);
  if (Either.isRight(result)) throw new Error("the file loaded but should not have");
  return result.left;
};

const realText = readFileSync(join(HARNESS_ROOT, CONFIG_FILE_NAME), "utf8");
const realConfig = loadedOrThrow(realText);

const gate = { name: "g", run: "echo hi", tier: "lean", limitSeconds: 5 };

describe("loadHarnessConfig defaults", () => {
  it("a project with no file gets the defaults, not an error: a missing file must not stop a fresh project", () => {
    expect(loadedOrThrow(null)).toEqual(HARNESS_DEFAULTS);
  });

  it("an empty object loads as the defaults: every key is optional", () => {
    expect(loadedOrThrow("{}")).toEqual(HARNESS_DEFAULTS);
  });

  it("the defaults name no path under app/ and hold no gate, login or path: they must stay generic", () => {
    expect(JSON.stringify(HARNESS_DEFAULTS)).not.toMatch(/(^|[^a-z0-9_./-])app\//);
    expect(HARNESS_DEFAULTS.gates).toEqual([]);
    expect(HARNESS_DEFAULTS.seedLogins).toEqual({});
    expect(HARNESS_DEFAULTS.paths).toEqual({});
  });

  it("the defaults hold the values the scripts used to hard-code: the review bot, the ready label, the login form, the docs", () => {
    expect(HARNESS_DEFAULTS.reviewBot).toEqual({ login: "greptile-apps", summaryMarker: "<!-- greptile_summary -->", trigger: "@greptileai review" });
    expect(HARNESS_DEFAULTS.tracker.readyLabel).toBe("ready-for-agent");
    expect(HARNESS_DEFAULTS.loginForm).toEqual({ path: "/login", emailTestId: "login-email", passwordTestId: "login-password", submitTestId: "login-submit" });
    expect(HARNESS_DEFAULTS.docs).toEqual({ product: "PRODUCT.md", design: "DESIGN.md", glossary: "GLOSSARY.md", adr: "docs/adr", features: "docs/features" });
    expect(HARNESS_DEFAULTS.scratchDirs).toEqual([".verify/", "tmp/"]);
    expect(HARNESS_DEFAULTS.baseBranch).toBeNull();
    expect(HARNESS_DEFAULTS.coauthor).toBe("Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>");
  });

  it("the wave defaults run two tracks, one review round, design and planning on the stronger model and mechanical work on the cheaper one", () => {
    expect(HARNESS_DEFAULTS.wave).toEqual({
      tracksAtOnce: 2,
      reviewRounds: 1,
      models: { plan: "opus", design: "opus", build: "sonnet", review: "sonnet", mechanical: "haiku" },
    });
  });

  it("this repo runs three tracks at once: the owner's choice for wave 2 must not fall back to the default", () => {
    expect(loadHarnessConfigFromDisk().wave.tracksAtOnce).toBe(3);
  });

  it("a wave section with one model set keeps the other models and the counts: a partial wave must not blank the planner's model", () => {
    const config = loadedOrThrow(JSON.stringify({ wave: { models: { mechanical: "sonnet" } } }));
    expect(config.wave).toEqual({ ...HARNESS_DEFAULTS.wave, models: { ...HARNESS_DEFAULTS.wave.models, mechanical: "sonnet" } });
  });

  it("refuses a wave that runs no track, more tracks than the cap, or a model name a shell could misread", () => {
    expect(faultOf(JSON.stringify({ wave: { tracksAtOnce: 0 } }))).toMatch(/wave\.tracksAtOnce/);
    expect(faultOf(JSON.stringify({ wave: { tracksAtOnce: 9 } }))).toMatch(/wave\.tracksAtOnce/);
    expect(faultOf(JSON.stringify({ wave: { reviewRounds: 4 } }))).toMatch(/wave\.reviewRounds/);
    expect(faultOf(JSON.stringify({ wave: { models: { build: "son net; rm" } } }))).toMatch(/wave\.models\.build/);
    expect(faultOf(JSON.stringify({ wave: { modls: {} } }))).toMatch(/modls/);
  });

  it("a section with one key set keeps the default for its other keys: a partial reviewBot must not blank the marker", () => {
    const config = loadedOrThrow(JSON.stringify({ reviewBot: { login: "acme" } }));
    expect(config.reviewBot).toEqual({ ...HARNESS_DEFAULTS.reviewBot, login: "acme" });
  });

  it("a key in the file replaces the default: the file must win", () => {
    const config = loadedOrThrow(JSON.stringify({ scratchDirs: ["x/"], baseBranch: "trunk", gates: [gate] }));
    expect(config.scratchDirs).toEqual(["x/"]);
    expect(config.baseBranch).toBe("trunk");
    expect(config.gates).toEqual([gate]);
  });

  it("the defaults object is not changed by a load: a shared default that a caller can edit would leak between projects", () => {
    const config = loadedOrThrow(JSON.stringify({ scratchDirs: ["x/"] }));
    config.scratchDirs.push("y/");
    expect(HARNESS_DEFAULTS.scratchDirs).toEqual([".verify/", "tmp/"]);
  });
});

describe("loadHarnessConfig faults", () => {
  it("a wrong type names the key: 'gates.0.limitSeconds' tells the author where to look", () => {
    const line = faultOf(JSON.stringify({ gates: [{ ...gate, limitSeconds: "slow" }] }));
    expect(line).toMatch(/^harness-config: gates\.0\.limitSeconds: /);
  });

  it("a wrong type in a section names the section key", () => {
    expect(faultOf(JSON.stringify({ tracker: { readyLabel: 3 } }))).toMatch(/tracker\.readyLabel/);
  });

  it("an unknown top-level key is refused and named: a typo must not pass in silence", () => {
    expect(faultOf(JSON.stringify({ gatez: [] }))).toMatch(/gatez/);
  });

  it("an unknown key inside a section is refused and named: 'readyLabl' would otherwise leave the default in force", () => {
    expect(faultOf(JSON.stringify({ tracker: { readyLabl: "x" } }))).toMatch(/readyLabl/);
  });

  it("a file that is not JSON is one plain line, not a stack trace", () => {
    expect(faultOf("{ nope")).toBe("harness-config: harness.config.json is not valid JSON");
  });

  it("a version other than 1 is refused: a future file must not load under today's rules", () => {
    expect(faultOf(JSON.stringify({ version: 2 }))).toMatch(/version/);
  });

  it("a gate name or command with a pipe or a line break is refused: verify.sh splits its lines on the pipe", () => {
    expect(faultOf(JSON.stringify({ gates: [{ ...gate, run: "a | b" }] }))).toMatch(/gates\.0\.run/);
    expect(faultOf(JSON.stringify({ gates: [{ ...gate, name: "a\nb" }] }))).toMatch(/gates\.0\.name/);
  });

  it("a gate with a zero or fractional limit is refused: a gate with no time limit would hang a run", () => {
    expect(faultOf(JSON.stringify({ gates: [{ ...gate, limitSeconds: 0 }] }))).toMatch(/limitSeconds/);
    expect(faultOf(JSON.stringify({ gates: [{ ...gate, limitSeconds: 1.5 }] }))).toMatch(/limitSeconds/);
  });

  it("a gate tier other than lean, baseline or full is refused: verify.sh would run that gate in no tier but the full run", () => {
    expect(faultOf(JSON.stringify({ gates: [{ ...gate, tier: "quick" }] }))).toMatch(/gates\.0\.tier/);
  });

  it("a seeded login without a password is refused and names the login", () => {
    expect(faultOf(JSON.stringify({ seedLogins: { admin: { email: "a@b.c" } } }))).toMatch(/seedLogins\.admin\.password/);
  });
});

describe("the real harness.config.json", () => {
  it("loads: the file in this repo must satisfy its own schema", () => {
    expect(Either.isRight(load(realText))).toBe(true);
  });

  it("holds the gates that verify.sh --list prints, in order: a gate added in one place only would run in neither", () => {
    const listed = spawnSync("./scripts/verify.sh", ["--list"], { cwd: HARNESS_ROOT, encoding: "utf8" });
    expect(listed.status).toBe(0);
    const rows = listed.stdout
      .trim()
      .split("\n")
      .map((line) => /^(\S+)\s+(lean|baseline|full)\s+(\d+)s\s+(.*)$/.exec(line));
    const fromList = rows.map((row) => ({ name: row?.[1], tier: row?.[2], limitSeconds: Number(row?.[3]), run: row?.[4] }));
    expect(fromList).toEqual(realConfig.gates);
  });

  it("keeps the CI=1 prefix on the e2e gate: without it the dev server needs a Cloudflare login", () => {
    expect(realConfig.gates.find((entry) => entry.name === "e2e")?.run).toMatch(/^CI=1 /);
  });

  it("sets every key the contract names under paths", () => {
    expect(Object.keys(realConfig.paths).sort()).toEqual([...NESTED_KEYS.paths].sort());
  });

  it("matches the seed fixtures' logins and local password: a stale login would fail every audit login", () => {
    const emails: Record<string, string> = FIXTURE_ROLE_EMAILS;
    for (const [name, login] of Object.entries(realConfig.seedLogins)) {
      expect(login.email, name).toBe(emails[name]);
      expect(login.password, name).toBe(LOCAL_FIXTURE_PASSWORD);
    }
  });
});

describe("stableJson", () => {
  it("sorts object keys at every depth: two files that differ only in key order must give one checksum", () => {
    expect(stableJson({ b: { d: 1, c: 2 }, a: [{ y: 1, x: 2 }] })).toBe('{"a":[{"x":2,"y":1}],"b":{"c":2,"d":1}}');
  });

  it("keeps array order and writes no whitespace: reordering a list changes its meaning", () => {
    expect(stableJson([3, 1, 2])).toBe("[3,1,2]");
    expect(stableJson({ a: "x y" })).toBe('{"a":"x y"}');
  });

  it("writes null, booleans and strings the way JSON does", () => {
    expect(stableJson({ a: null, b: true, c: 'q"' })).toBe('{"a":null,"b":true,"c":"q\\""}');
  });

  it("agrees with the workflow library's copy: the workflow recomputes the checksum with its own function", () => {
    const lib = readFileSync(join(HARNESS_ROOT, ".claude/workflow-src/lib.js"), "utf8");
    if (!lib.includes("function stableJson")) return;
    const body = /function stableJson\([\s\S]*?\n}\n/.exec(lib)?.[0] ?? "";
    const theirs = new Function(`${body}; return stableJson;`)() as (value: unknown) => string;
    const sample = { z: [1, { b: 1, a: [null, "x"] }], a: { y: true, x: 0 } };
    expect(theirs(sample)).toBe(stableJson(sample));
  });
});

describe("harness-config CLI", () => {
  const withReal = depsWith(realText);

  it("show prints one line of JSON whose check is the FNV checksum of the stable JSON: the workflow recomputes it", () => {
    const out = run(["show"], withReal);
    expect(out.code).toBe(0);
    expect(out.stdout).toHaveLength(1);
    const parsed = JSON.parse(out.stdout[0] ?? "");
    expect(parsed.check).toBe(ledgerChecksum(stableJson(parsed.config)));
    expect(parsed.check).toBe(configChecksum(shownConfig(realConfig)));
    expect(parsed.check).toMatch(/^[0-9a-f]{8}$/);
  });

  it("show of a missing file prints the defaults, so a bare project still runs", () => {
    const parsed = JSON.parse(run(["show"], depsWith(null)).stdout[0] ?? "");
    expect(parsed.config).toEqual(shownConfig(HARNESS_DEFAULTS));
  });

  it("regression: show leaves seedLogins out and still verifies through readConfig, while get and the loader keep them: a run's journal must not hold the seeded passwords", () => {
    const line = run(["show"], withReal).stdout[0] ?? "";
    expect(line).not.toContain("seedLogins");
    expect(line).not.toContain(realConfig.seedLogins.admin?.password ?? "no-password");
    expect(readConfig(line).config).toEqual(shownConfig(realConfig));
    expect(Object.keys(realConfig.seedLogins).length).toBeGreaterThan(0);
    expect(run(["get", "seedLogins.admin.email"], withReal).stdout).toEqual([realConfig.seedLogins.admin?.email]);
  });

  it("get prints a string as is and a number as is", () => {
    expect(run(["get", "tracker.readyLabel"], withReal).stdout).toEqual(["ready-for-agent"]);
    expect(run(["get", "version"], withReal).stdout).toEqual(["1"]);
  });

  it("get prints a list of strings one per line: bash loops over it", () => {
    expect(run(["get", "paths.sourceRoots"], withReal).stdout).toEqual(["app", "workers"]);
  });

  it("get prints null and objects as compact JSON", () => {
    expect(run(["get", "baseBranch"], withReal).stdout).toEqual(["null"]);
    expect(run(["get", "tracker"], withReal).stdout).toEqual(['{"readyLabel":"ready-for-agent"}']);
  });

  it("get of an unknown key exits 1 and names it, rather than printing an empty line", () => {
    const out = run(["get", "tracker.nope"], withReal);
    expect(out.code).toBe(1);
    expect(out.stderr.join("\n")).toContain("tracker.nope");
  });

  it("get does not walk the prototype chain: 'constructor' is not a key", () => {
    expect(run(["get", "constructor"], withReal).code).toBe(1);
  });

  it("gates prints name|run|tier|limit, one line per gate, as verify.sh reads them", () => {
    const out = run(["gates"], depsWith(JSON.stringify({ gates: [gate, { ...gate, name: "h", tier: "full" }] })));
    expect(out.stdout).toEqual(["g|echo hi|lean|5", "h|echo hi|full|5"]);
  });

  it("gates with none set exits 1 with the line that says what to set", () => {
    const out = run(["gates"], depsWith(null));
    expect(out.code).toBe(1);
    expect(out.stderr).toEqual(["harness-config: set gates in harness.config.json"]);
  });

  it("check prints ok with the gate count", () => {
    expect(run(["check"], withReal)).toEqual({ code: 0, stdout: [`harness-config: ok (${realConfig.gates.length} gates)`], stderr: [] });
  });

  it("check exits 1 with the fault when the file is bad, so the harness gate goes red", () => {
    const out = run(["check"], depsWith(JSON.stringify({ gatez: 1 })));
    expect(out.code).toBe(1);
    expect(out.stderr.join("\n")).toContain("gatez");
  });

  it("every verb reports a bad file, not just check", () => {
    for (const verb of ["show", "gates"]) expect(run([verb], depsWith("{")).code, verb).toBe(1);
  });

  it("no verb, an unknown verb, and a stray argument exit 2", () => {
    expect(run([], withReal).code).toBe(2);
    expect(run(["nope"], withReal).code).toBe(2);
    expect(run(["show", "extra"], withReal).code).toBe(2);
    expect(run(["get"], withReal).code).toBe(2);
  });

  it("the real defaultDeps read this repo's file", () => {
    expect(run(["check"], defaultDeps).code).toBe(0);
  });
});

describe("docs/agents/harness-config.md", () => {
  const doc = readFileSync(join(HARNESS_ROOT, "docs/agents/harness-config.md"), "utf8");
  const names = [...CONFIG_KEYS, ...Object.values(NESTED_KEYS).flat()];

  it("names every key of the schema in backticks: a key with no docs is a setting nobody can find", () => {
    const missing = [...new Set(names)].filter((key) => !doc.includes(`\`${key}\``));
    expect(missing).toEqual([]);
  });

  it("is linked from harness.md", () => {
    expect(readFileSync(join(HARNESS_ROOT, "docs/agents/harness.md"), "utf8")).toContain("harness-config.md");
  });
});

describe("shell readers", () => {
  const text = (file: string) => readFileSync(join(HARNESS_ROOT, file), "utf8");

  it("verify.sh reads its gates from the config: a GATES literal would let the two lists drift", () => {
    const source = text("scripts/verify.sh");
    expect(source).toContain("scripts/harness-config.ts gates");
    for (const entry of realConfig.gates) expect(source).not.toContain(entry.run);
  });

  it("verify.sh exits when the gates command fails: a failed read must not run no gates and pass", () => {
    expect(text("scripts/verify.sh")).toMatch(/GATES=\$\(bun scripts\/harness-config\.ts gates\) \|\| \{[^}]*exit 1/);
  });

  it("harness-check.sh runs the config check as check M", () => {
    const source = text("scripts/harness-check.sh");
    expect(source).toContain("bun scripts/harness-config.ts check");
    expect(source).toMatch(/#\s+M\. harness\.config\.json/);
  });
});
