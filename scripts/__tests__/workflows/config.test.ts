/**
 * The three workflows read their project values from harness.config.json, through the one line their
 * Preflight returns as config_json. These tests drive the built scripts with scripted agents and a
 * changed config, and pin two promises: a copy that does not verify stops the run before any other
 * agent starts, and a value in the config reaches the prompts that used to hold it as a literal.
 */
import { describe, expect, it } from "vitest";
import { configLine, dryRun, labels, type AnswerRule } from "../../lib/workflow-dry-run";
import type { HarnessConfig } from "../../lib/harness-config";
import { andList, readConfig, reEscape } from "../../../.claude/workflow-src/lib.js";
import * as brand from "./brand-init.fixtures";
import * as plan from "./plan-feature.fixtures";
import * as ship from "./ship-feature.fixtures";

const garbles: [string, (line: string) => string][] = [
  ["one character changed", (line) => line.replace("greptile-apps", "greptile-appz")],
  ["bad JSON", (line) => line.slice(0, -5)],
  ["a wrong check", (line) => JSON.stringify({ ...JSON.parse(line), check: "00000000" })],
  ["a line with no config", () => JSON.stringify({ check: "00000000" })],
];

const customize = (config: HarnessConfig): HarnessConfig => ({
  ...config,
  baseBranch: "develop",
  coauthor: "Co-Authored-By: Test Agent <agent@example.com>",
  docs: { ...config.docs, product: "docs/BRIEF.md", design: "docs/LOOK.md", glossary: "docs/TERMS.md" },
  paths: {
    ...config.paths,
    tokens: "src/styles.css",
    rootLayout: "src/root.tsx",
    routes: "src/pages",
    home: "src/pages/index.tsx",
    components: "src/parts",
    primitives: "src/ui",
    locales: "src/i18n",
    hooks: "src/hooks",
    routeTable: "src/pages.ts",
  },
});

describe("readConfig", () => {
  it("accepts the line show prints: the real file must verify, or no workflow can start", () => {
    expect(readConfig(configLine()).config).toMatchObject({ coauthor: expect.stringContaining("Co-Authored-By") });
  });

  it.each(garbles)("refuses %s with the run-again line: a garbled copy must not become the config", (_name, garble) => {
    expect(readConfig(garble(configLine())).error).toMatch(/config copy did not verify; run the workflow again/);
  });

  it("names the key a workflow needs and the file lacks: a missing path must not turn into the word undefined in a prompt", () => {
    expect(readConfig(configLine(), ["paths.tokens"]).error).toBeUndefined();
    expect(readConfig(configLine((config) => ({ ...config, paths: {} })), ["paths.tokens"]).error).toBe("harness-config: set paths.tokens in harness.config.json");
    expect(readConfig(configLine((config) => ({ ...config, ship: {} })), ["ship.sharedFiles"]).error).toBe("harness-config: set ship.sharedFiles in harness.config.json");
  });
});

describe("andList and reEscape", () => {
  it("andList joins the way the prompts did: 'a, b and c', 'a and b', 'a'", () => {
    expect(andList(["app/", "workers/", "scripts/"])).toBe("app/, workers/ and scripts/");
    expect(andList(["app/", "workers/"])).toBe("app/ and workers/");
    expect(andList(["app/"])).toBe("app/");
  });

  it("reEscape makes a path match itself only: a dot in a file name must not match any character", () => {
    expect(new RegExp(`^${reEscape("app/app.css")}$`).test("app/app.css")).toBe(true);
    expect(new RegExp(`^${reEscape("app/app.css")}$`).test("app/appxcss")).toBe(false);
  });
});

describe.each(garbles)("a config copy that does not verify (%s)", (_name, garble) => {
  const line = garble(configLine());

  it("plan-feature stops at Preflight before any other agent runs", async () => {
    const run = await dryRun("plan-feature", { args: { ticket: "#12" }, answers: plan.rules([["preflight", { ...plan.PREFLIGHT, config_json: line }]]) });
    expect(labels(run.calls)).toEqual(["preflight"]);
    expect(run.result).toMatchObject({ stopped: "Preflight", reason: expect.stringContaining("did not verify") });
  });

  it("ship-feature stops at Preflight before any other agent runs", async () => {
    const run = await dryRun("ship-feature", { args: ship.ARGS, answers: ship.happy([["config", { ...ship.CONFIG_OK, config_json: line }]]) });
    expect(labels(run.calls)).toEqual(["config"]);
    expect(run.result).toMatchObject({ stopped: "Preflight", reason: expect.stringContaining("did not verify") });
  });

  it("brand-init stops at Preflight before any other agent runs", async () => {
    const answers = brand.rules([["preflight", { ok: true, reason: "", branch: "feat/brand-init", root: brand.ROOT, config_json: line }]]);
    const run = await dryRun("brand-init", { args: {}, answers });
    expect(labels(run.calls)).toEqual(["preflight"]);
    expect(run.result).toMatchObject({ error: expect.stringContaining("did not verify") });
  });
});

describe("a config with other paths, docs, base branch and co-author", () => {
  const changed = configLine(customize);

  it("plan-feature names the config's product doc and home route in the interview and its design doc and tokens in the UX prompt", async () => {
    const interview: AnswerRule[] = [
      ["preflight", { ...plan.PREFLIGHT, has_product: false, config_json: changed }],
      ["product:interview", { questions: [{ id: "q1", question: "Who is it for?", draft: "owners", confident: true }] }],
      ["product:write", { written: true, note: "" }],
    ];
    const first = await dryRun("plan-feature", { args: { ticket: "#12" }, answers: plan.rules(interview) });
    const ask = first.calls.find((c) => c.label === "product:interview")?.prompt ?? "";
    expect(ask).toContain("docs/BRIEF.md is missing");
    expect(ask).toContain("src/pages/index.tsx");
    expect(ask).not.toMatch(/PRODUCT\.md|app\/routes\/home\.tsx/);

    const brief = { decision: "approve", answers: { q1: "weekly" }, hasUi: true, research: false };
    const noDesign: AnswerRule[] = [["preflight", { ...plan.PREFLIGHT, has_design: false, config_json: changed }]];
    const second = await dryRun("plan-feature", { args: { ticket: "#12", brief }, answers: plan.rules(noDesign) });
    const ux = second.calls.find((c) => c.label === "ux")?.prompt ?? "";
    expect(ux).toContain("Read /repo/docs/BRIEF.md (docs/LOOK.md does not exist yet");
    expect(ux).toContain("tokens in src/styles.css");
    expect(ux).not.toMatch(/PRODUCT\.md|DESIGN\.md|app\/app\.css/);
    const stack = second.calls.find((c) => c.label === "stack")?.prompt ?? "";
    expect(stack).toContain("PR 1 targets develop");
  });

  it("ship-feature fetches the config's base branch and signs commits with the config's co-author line", async () => {
    const run = await dryRun("ship-feature", { args: ship.ARGS, answers: ship.happy([["config", { ...ship.CONFIG_OK, config_json: changed }]]) });
    const preflight = run.calls.find((c) => c.label === "preflight")?.prompt ?? "";
    expect(preflight).toContain("git fetch -q origin develop");
    expect(preflight).not.toContain("origin main");
    const trailers = run.calls.flatMap((c) => c.prompt.match(/Co-Authored-By: [^\n"\\]+/g) ?? []);
    expect(trailers.length).toBeGreaterThan(0);
    expect([...new Set(trailers)]).toEqual(["Co-Authored-By: Test Agent <agent@example.com>"]);
  });

  it("ship-feature sorts a PR's files into UI and backend lanes by the config's paths: a route under the old folder is no longer UI", async () => {
    const run = await dryRun("ship-feature", { args: ship.ARGS, answers: ship.happy([["config", { ...ship.CONFIG_OK, config_json: changed }]]) });
    expect(labels(run.calls)).toContain("build:pr2-backend");
    expect(labels(run.calls)).not.toContain("build:pr2-ui");
    const normal = await dryRun("ship-feature", { args: ship.ARGS, answers: ship.happy() });
    expect(labels(normal.calls)).toContain("build:pr2-ui");
  });

  it("brand-init takes its lanes from the config: a primitive dropped from a lane leaves that lane's fence, and the tokens path moves", async () => {
    const lanes = configLine((config) => {
      const custom = customize(config);
      const primitiveLanes = (custom.brandInit.primitiveLanes ?? []).map((lane, i) => (i === 0 ? { ...lane, files: lane.files.filter((f) => f !== "switch") } : lane));
      return { ...custom, brandInit: { ...custom.brandInit, contractFence: ["src/styles.css", "src/root.tsx"], primitiveLanes } };
    });
    const answers = brand.rules([["preflight", { ok: true, reason: "", branch: "feat/brand-init", root: brand.ROOT, config_json: lanes }]]);
    const r1 = await dryRun("brand-init", { args: {}, answers });
    const r2 = await dryRun("brand-init", { args: { answers: brand.ANSWERS }, answers, resumeFrom: r1 });
    const r3 = await dryRun("brand-init", { args: brand.SHIP_ARGS, answers, resumeFrom: r2 });
    const buttons = brand.one(r3, "build:primitives:buttons-toggles").prompt;
    expect(brand.fenceIn(buttons)).toEqual(["src/ui/button.tsx", "src/ui/button-group.tsx", "src/ui/toggle.tsx", "src/ui/toggle-group.tsx"]);
    const tokens = brand.one(r3, "contract:tokens").prompt;
    expect(tokens).toContain("src/styles.css");
    expect(tokens).toContain("src/root.tsx");
    expect(tokens).not.toMatch(/app\/app\.css|app\/root\.tsx/);
    expect(brand.one(r3, "build:shell").prompt).toContain("src/i18n/en");
  });
});
