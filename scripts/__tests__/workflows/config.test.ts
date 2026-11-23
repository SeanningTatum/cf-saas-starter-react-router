import { describe, expect, it } from "vitest";
import { configLine, configLineFromFile, dryRun, labels, type AnswerRule } from "../../lib/workflow-dry-run";
import { loadHarnessConfigFromDisk, type HarnessConfig } from "../../lib/harness-config";
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
    expect(
      readConfig(
        configLine((config) => ({ ...config, paths: {} })),
        ["paths.tokens"],
      ).error,
    ).toBe("harness-config: set paths.tokens in harness.config.json");
    expect(
      readConfig(
        configLine((config) => ({ ...config, ship: {} })),
        ["ship.sharedFiles"],
      ).error,
    ).toBe("harness-config: set ship.sharedFiles in harness.config.json");
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
    const run = await dryRun("plan-feature", { args: { ticket: "#12" }, answers: plan.rules([["config", { ...plan.CONFIG_OK, config_json: line }]]) });
    expect(labels(run.calls)).toEqual(["config"]);
    expect(run.result).toMatchObject({ stopped: "Preflight", reason: expect.stringContaining("did not verify") });
  });

  it("ship-feature stops at Preflight before any other agent runs", async () => {
    const run = await dryRun("ship-feature", { args: ship.ARGS, answers: ship.happy([["config", { ...ship.CONFIG_OK, config_json: line }]]) });
    expect(labels(run.calls)).toEqual(["config"]);
    expect(run.result).toMatchObject({ stopped: "Preflight", reason: expect.stringContaining("did not verify") });
  });

  it("brand-init stops at Preflight before any other agent runs", async () => {
    const answers = brand.rules([["config", { ...brand.CONFIG_OK, config_json: line }]]);
    const run = await dryRun("brand-init", { args: {}, answers });
    expect(labels(run.calls)).toEqual(["config"]);
    expect(run.result).toMatchObject({ error: expect.stringContaining("did not verify") });
  });
});

describe("a config with other paths, docs, base branch and co-author", () => {
  const changed = configLine(customize);

  it("plan-feature names the config's product doc and home route in the interview and its design doc and tokens in the UX prompt", async () => {
    const interview: AnswerRule[] = [
      ["config", { ...plan.CONFIG_OK, config_json: changed }],
      ["preflight", { ...plan.PREFLIGHT, has_product: false }],
      ["product:interview", { questions: [{ id: "q1", question: "Who is it for?", draft: "owners", confident: true }] }],
      ["product:write", { written: true, note: "" }],
    ];
    const first = await dryRun("plan-feature", { args: { ticket: "#12" }, answers: plan.rules(interview) });
    const ask = first.calls.find((c) => c.label === "product:interview")?.prompt ?? "";
    expect(ask).toContain("docs/BRIEF.md is missing");
    expect(ask).toContain("src/pages/index.tsx");
    expect(ask).not.toMatch(/PRODUCT\.md|app\/routes\/home\.tsx/);

    const brief = { decision: "approve", answers: { q1: "weekly" }, hasUi: true, research: false };
    const noDesign: AnswerRule[] = [
      ["config", { ...plan.CONFIG_OK, config_json: changed }],
      ["preflight", { ...plan.PREFLIGHT, has_design: false }],
    ];
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
    expect(preflight).toContain("'develop'");
    expect(preflight).not.toContain("bun scripts/default-branch.ts");
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
      const primitiveLanes = (custom.brandInit.primitiveLanes ?? []).map((lane, i) =>
        i === 0 ? { ...lane, files: lane.files.filter((f) => f !== "switch") } : lane,
      );
      return { ...custom, brandInit: { ...custom.brandInit, contractFence: ["src/styles.css", "src/root.tsx"], primitiveLanes } };
    });
    const answers = brand.rules([["config", { ...brand.CONFIG_OK, config_json: lanes }]]);
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

const one = (calls: { label: string; prompt: string }[], label: string) => {
  const found = calls.find((c) => c.label === label);
  if (!found) throw new Error(`no call labelled ${label}; got ${calls.map((c) => c.label).join(", ")}`);
  return found;
};

describe("regression: a fork that moves the product and design docs", () => {
  const moved = configLineFromFile({ docs: { product: "docs/BRIEF.md", design: "docs/LOOK.md" } });

  it("plan-feature reads the config first, with no ticket text in that call, and its Preflight checks the configured docs", async () => {
    const answers = plan.rules([["config", { ...plan.CONFIG_OK, config_json: moved }]]);
    const run = await dryRun("plan-feature", { args: { ticket: "#12" }, answers });
    expect(run.calls[0]?.label).toBe("config");
    expect(run.calls[0]?.prompt).not.toMatch(/#12|tracker|ticket/i);
    expect(run.calls[0]?.prompt).not.toContain(plan.INJECTION);
    const preflight = one(run.calls, "preflight").prompt;
    expect(preflight).toContain("Does ROOT/docs/BRIEF.md exist? -> has_product");
    expect(preflight).toContain("Does ROOT/docs/LOOK.md exist? -> has_design");
    expect(preflight).not.toMatch(/PRODUCT\.md|DESIGN\.md/);
  });

  it("brand-init reads the config first, and its brand check looks for the configured design doc: a moved design doc must not be overwritten without redo", async () => {
    const answers = brand.rules([["config", { ...brand.CONFIG_OK, config_json: moved }]]);
    const run = await dryRun("brand-init", { args: {}, answers });
    expect(run.calls[0]?.label).toBe("config");
    expect(run.calls[0]?.prompt).not.toMatch(/DESIGN|LOOK|redo/);
    const preflight = one(run.calls, "preflight").prompt;
    expect(preflight).toContain("If docs/LOOK.md exists at ROOT and redo is false");
    expect(preflight).toContain("leave docs/LOOK.md in place");
    expect(preflight).not.toMatch(/DESIGN\.md/);
  });
});

describe("regression: a fork that renames or drops the sequential shared lane", () => {
  const shared = loadHarnessConfigFromDisk().brandInit.sharedLanes ?? [];
  const build = async (sharedLanes: unknown) => {
    const config_json = configLineFromFile({ brandInit: { sharedLanes } });
    const answers = brand.rules([["config", { ...brand.CONFIG_OK, config_json }]]);
    const r1 = await dryRun("brand-init", { args: {}, answers });
    const r2 = await dryRun("brand-init", { args: { answers: brand.ANSWERS }, answers, resumeFrom: r1 });
    return dryRun("brand-init", { args: brand.SHIP_ARGS, answers, resumeFrom: r2 });
  };
  const builds = (r: Awaited<ReturnType<typeof build>>) => labels(r.calls).filter((l) => /^build:(?!polish|fence-diff|typecheck)/.test(l));

  it("a lane named app-shell with sequential: true runs alone, after every other lane, and gets the shell task", async () => {
    const r = await build(shared.map((l) => (l.name === "shell" ? { ...l, name: "app-shell", sequential: true } : l)));
    const order = builds(r);
    expect(order.at(-1)).toBe("build:app-shell");
    expect(order).not.toContain("build:shell");
    expect(brand.one(r, "build:app-shell").prompt).toContain("You own the app shells and the brand copy");
    expect(brand.one(r, "build:shared").prompt).toContain("typeset wordmark");
    expect(r.logs.some((l) => /in parallel, then app-shell$/.test(l))).toBe(true);
    expect(r.result).toMatchObject({ ship: { shipped: true } });
  });

  it("a config with no sequential lane builds every lane in the one parallel wave and does not look for a lane called shell", async () => {
    const r = await build(shared.map((l) => (l.name === "shell" ? { name: "chrome", motion: l.motion, owns: l.owns } : l)));
    expect(builds(r)).toContain("build:chrome");
    expect(r.logs.some((l) => /in parallel$/.test(l))).toBe(true);
    expect(brand.one(r, "build:chrome").prompt).toContain("Rebuild the files you own");
    expect(r.result).toMatchObject({ ship: { shipped: true } });
  });

  it("an empty sharedLanes list is a value: the run builds the primitives alone", async () => {
    const r = await build([]);
    expect(builds(r).every((l) => l.startsWith("build:primitives:") || l === "build:home")).toBe(true);
    expect(r.result).toMatchObject({ ship: { shipped: true } });
  });
});

describe("regression: a fork that moves the analytics events file", () => {
  const paths = (events: string) => ({
    appRoot: "src",
    sourceRoots: ["src/"],
    routes: "src/routes",
    components: "src/components",
    locales: "src/locales",
    hooks: "src/hooks",
    trpc: "src/trpc",
    repositories: "src/repositories",
    schemas: "src/schemas",
    analyticsEvents: events,
  });
  const plan2 = (events: string) => ({
    ...ship.PLAN,
    prs: [
      { ...ship.PR1, fence: ["src/trpc/widget.ts", events] },
      { ...ship.PR2, fence: ["src/routes/widget.tsx", "src/lib/format.ts"] },
    ],
  });
  const stop = (events: string) =>
    dryRun("ship-feature", {
      args: ship.ARGS,
      answers: ship.happy([
        ["config", { ...ship.CONFIG_OK, config_json: configLineFromFile({ paths: paths(events), ship: { sharedFiles: [] } }) }],
        ["intake:record", plan2(events)],
      ]),
    });
  const owned = (prompt: string) =>
    (prompt.split("FILE FENCE")[1]?.split("A file outside them")[0] ?? "")
      .split("\n")
      .filter((line) => line.startsWith("  · "))
      .map((line) => line.slice(4));

  it.each(["src/events.ts", "events.ts"])(
    "with the events file at %s, only that file leaves the build lanes: every other source fence keeps its builder",
    async (events) => {
      const run = await stop(events);
      expect(labels(run.calls)).toEqual(expect.arrayContaining(["build:pr1-backend", "build:pr2-backend", "build:pr2-ui"]));
      expect(owned(one(run.calls, "build:pr1-backend").prompt)).toEqual(["src/trpc/widget.ts"]);
      expect(owned(one(run.calls, "build:pr2-backend").prompt)).toEqual(["src/lib/format.ts"]);
      expect(owned(one(run.calls, "build:pr2-ui").prompt)).toEqual(["src/routes/widget.tsx"]);
    },
  );
});

describe("regression: empty lists are values", () => {
  it("readConfig accepts an empty list for a needed key and still refuses an empty string and a missing key", () => {
    expect(
      readConfig(
        configLine((c) => ({ ...c, ship: { sharedFiles: [] } })),
        ["ship.sharedFiles"],
      ).error,
    ).toBeUndefined();
    expect(
      readConfig(
        configLine((c) => ({ ...c, paths: { ...c.paths, tokens: "" } })),
        ["paths.tokens"],
      ).error,
    ).toBe("harness-config: set paths.tokens in harness.config.json");
    expect(
      readConfig(
        configLine((c) => ({ ...c, ship: {} })),
        ["ship.sharedFiles"],
      ).error,
    ).toBe("harness-config: set ship.sharedFiles in harness.config.json");
  });

  it("ship-feature with ship.sharedFiles: [] passes Preflight and goes on to the build", async () => {
    const config_json = configLineFromFile({ ship: { sharedFiles: [] } });
    const run = await dryRun("ship-feature", { args: ship.ARGS, answers: ship.happy([["config", { ...ship.CONFIG_OK, config_json }]]) });
    expect(labels(run.calls)).toContain("preflight");
    expect(run.result).toMatchObject({ status: "needs-ship" });
  });

  it("brand-init with brandInit.sharedLanes: [] passes Preflight and reaches the brief stop", async () => {
    const config_json = configLineFromFile({ brandInit: { sharedLanes: [] } });
    const run = await dryRun("brand-init", { args: {}, answers: brand.rules([["config", { ...brand.CONFIG_OK, config_json }]]) });
    expect(labels(run.calls)).toContain("preflight");
    expect(run.result).toMatchObject({ status: "needs-input" });
  });

  it("ship-feature says so plainly when paths.sourceRoots is empty: a build with no source folder has nothing to name", async () => {
    const config_json = configLineFromFile({ paths: { sourceRoots: [] } });
    const run = await dryRun("ship-feature", { args: ship.ARGS, answers: ship.happy([["config", { ...ship.CONFIG_OK, config_json }]]) });
    expect(labels(run.calls)).toEqual(["config"]);
    expect(run.result).toMatchObject({ stopped: "Preflight", reason: expect.stringContaining("paths.sourceRoots") });
  });
});

describe("regression: the spelling of a folder does not change who owns a file", () => {
  const route = async (routes: string) => {
    const config_json = configLineFromFile({ paths: { routes }, ship: { sharedFiles: [] } });
    const plan1 = { ...ship.PLAN, prs: [{ ...ship.PR1, fence: ["src/pages/widget.tsx"] }] };
    const answers = ship.happy([
      ["config", { ...ship.CONFIG_OK, config_json }],
      ["intake:record", plan1],
    ]);
    const run = await dryRun("ship-feature", { args: ship.ARGS, answers });
    return labels(run.calls).filter((l) => /^build:pr\d+-/.test(l));
  };

  it("paths.routes with and without a trailing slash send src/pages/widget.tsx to the same builder", async () => {
    const plain = await route("src/pages");
    const slashed = await route("src/pages/");
    expect(slashed).toEqual(plain);
    expect(plain).toEqual(["build:pr1-ui"]);
  });

  it("paths.appRoot: src does not take src-tools/gen.ts as app code: it is escalated, not handed to the orphan lane, while src/tools/gen.ts is", async () => {
    const config_json = configLineFromFile({ paths: { appRoot: "src" } });
    const finding = (file: string): AnswerRule => [
      "check:impeccable-critique",
      { verdict: "FAIL", findings: [{ severity: "P1", issue: "generated header is wrong", file }], evidence: "shots" },
    ];
    const run = async (file: string) => {
      const answers = brand.rules([["config", { ...brand.CONFIG_OK, config_json }], finding(file)]);
      const r1 = await dryRun("brand-init", { args: {}, answers });
      const r2 = await dryRun("brand-init", { args: { answers: brand.ANSWERS }, answers, resumeFrom: r1 });
      return dryRun("brand-init", { args: brand.SHIP_ARGS, answers, resumeFrom: r2 });
    };
    const outside = await run("src-tools/gen.ts");
    expect(outside.logs).toContain("Finding outside src/, no lane may fix it, escalating: src-tools/gen.ts");
    expect(labels(outside.calls).filter((l) => l.endsWith(":orphans"))).toEqual([]);
    const inside = await run("src/tools/gen.ts");
    expect(labels(inside.calls)).toContain("fix:1:orphans");
  });
});
