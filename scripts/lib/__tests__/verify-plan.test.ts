import { Either } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryRepo } from "../../lint/repo";
import { parseTestMap } from "../../lint/test-map/map";
import { e2eSpecsFor, fullRunReasons, planChanged, renderPlan, shellQuote, type Plan } from "../verify-plan";
import { COMMAND, GATE, NO_MAP_REASON, SKIP_REASON, UNSAFE_PATH_REASON } from "../verify-plan-constants";

const testMap = () =>
  JSON.stringify({
    entries: [
      { match: "app/**/*.machine.ts", kind: "machine" },
      { match: "app/entry.client.tsx", kind: "covered-by", test: "e2e/auth.spec.ts", reason: "every spec hydrates through it" },
      { match: "app/routes/**", kind: "route" },
      { match: "app/lib/**", kind: "unit" },
      { match: "e2e/lib/**", kind: "spec-helper" },
    ],
  });

const spec = (body: string) => `import { test, expect } from "@playwright/test";\n${body}\ntest("x", async () => { expect(1).toBe(1); });\n`;

const tree = (extra: Record<string, string> = {}) =>
  memoryRepo({
    "scripts/lint/test-map.json": testMap(),
    "app/routes.ts": 'import { route } from "@react-router/dev/routes";\nexport default [route("/login", "routes/login.tsx")];\n',
    "app/routes/login.tsx": "export default function Login() { return null; }\n",
    "app/lib/sum.ts": "export const sum = (a: number, b: number) => a + b;\n",
    "app/entry.client.tsx": "hydrate();\n",
    "app/components/door.machine.ts": "export const door = 1;\n",
    "e2e/lib/session.ts": "export const login = async () => undefined;\n",
    "e2e/auth.spec.ts": spec('test("in", async ({ page }) => { await page.goto("/login"); });'),
    "e2e/door.paths.spec.ts": spec('import { door } from "../app/components/door.machine";'),
    "e2e/admin.spec.ts": spec('import { login } from "./lib/session";'),
    ...extra,
  });

const lean = (plan: Plan) => {
  if (plan.kind !== "lean") return expect.unreachable(`expected a lean plan, got ${JSON.stringify(plan)}`);
  return plan;
};

const gates = (plan: Plan) => lean(plan).run.map((step) => step.gate);

describe("fullRunReasons", () => {
  it.each([
    ["scripts/verify.sh", "the gate runner"],
    ["scripts/lib/verify-plan.ts", "the gate runner"],
    ["scripts/check-non-negotiables.ts", "a gate script"],
    ["scripts/lint/rules/no-throw.ts", "the house linter"],
    ["scripts/lint/baseline.json", "the house linter"],
    ["package.json", "a config file"],
    ["tsconfig.cloudflare.json", "a config file"],
    ["vitest.config.ts", "a config file"],
    ["wrangler.jsonc", "a config file"],
    ["bun.lock", "the lockfile"],
    [".github/workflows/ci.yml", "a CI workflow"],
    [".claude/workflow-src/ship-feature.js", "a harness file"],
    ["drizzle/0007_add.sql", "a migration"],
    ["app/db/schema.ts", "the schema"],
  ])("%s forces the full run (%s): a lean run cannot prove a change to what the gates themselves read", (path, reason) => {
    const reasons = fullRunReasons([path]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(path);
    expect(reasons[0]).toContain(reason);
  });

  it.each(["app/lib/sum.ts", "app/routes/login.tsx", "docs/ci/pipelines.md", "scripts/memory.ts", "e2e/auth.spec.ts", "scripts/lintish.ts"])(
    "%s stays lean: an ordinary source or doc change must not pay for the whole suite",
    (path) => {
      expect(fullRunReasons([path])).toEqual([]);
    },
  );

  it("every script verify.sh and the harness gate run forces the full run (catches the trigger list drifting from the gates)", () => {
    const read = (file: string) => readFileSync(join(__dirname, "..", "..", "..", file), "utf-8");
    const named = (text: string) => text.match(/scripts\/[\w./-]+\.(?:ts|sh)/g) ?? [];
    const looped = [...read("scripts/harness-check.sh").matchAll(/for t in ([\w -]+); do/g)].flatMap((m) => (m[1] ?? "").split(" ").map((t) => `scripts/${t}.sh`));
    const gateScripts = [...new Set([...named(read("scripts/verify.sh")), ...named(read("scripts/harness-check.sh")), ...looped])];
    expect(gateScripts.length).toBeGreaterThan(5);
    expect(gateScripts.filter((path) => fullRunReasons([path]).length === 0)).toEqual([]);
  });

  it("a path with a | or a line break forces the full run: the plan's line format would split it", () => {
    expect(fullRunReasons(["app/a|b.ts", "app/c\nd.ts"])).toEqual([UNSAFE_PATH_REASON, UNSAFE_PATH_REASON]);
  });
});

describe("e2eSpecsFor", () => {
  const map = () => Either.getOrThrow(parseTestMap(testMap()));

  it.each([
    [["e2e/admin.spec.ts"], ["e2e/admin.spec.ts"], "a changed spec runs itself"],
    [["app/entry.client.tsx"], ["e2e/auth.spec.ts"], "a covered-by entry names its spec"],
    [["app/components/door.machine.ts"], ["e2e/door.paths.spec.ts"], "a machine runs its paths spec"],
    [["app/routes/login.tsx"], ["e2e/auth.spec.ts"], "a route runs the specs that visit its path"],
    [["e2e/lib/session.ts"], ["e2e/admin.spec.ts"], "a spec helper runs the specs that import it"],
    [["app/lib/sum.ts"], [], "a unit file runs no spec"],
    [["app/lib/sum.ts", "app/routes/login.tsx", "app/entry.client.tsx"], ["e2e/auth.spec.ts"], "a spec named twice runs once"],
  ])("%j -> %j: %s", (changed, expected) => {
    expect(e2eSpecsFor(tree(), map(), changed)).toEqual(expected);
  });

  it("drops a machine's paths spec that does not exist: playwright would fail on a missing file", () => {
    const repo = tree({ "app/components/gate.machine.ts": "export const gate = 1;\n" });
    expect(e2eSpecsFor(repo, map(), ["app/components/gate.machine.ts"])).toEqual([]);
  });
});

describe("planChanged", () => {
  it("a source change runs typecheck, the linter and the related unit tests on that file, and says why e2e is skipped", () => {
    const plan = lean(planChanged(tree(), ["app/lib/sum.ts"]));
    expect(plan.run).toEqual([
      { gate: GATE.typecheck, command: COMMAND.typecheck },
      { gate: GATE.lint, command: `${COMMAND.lint} 'app/lib/sum.ts'` },
      { gate: GATE.test, command: `${COMMAND.test} 'app/lib/sum.ts'` },
    ]);
    expect(plan.skip).toEqual([{ gate: GATE.e2e, reason: SKIP_REASON.noSpec }]);
  });

  it("a route change adds the e2e specs that visit it", () => {
    const plan = lean(planChanged(tree(), ["app/routes/login.tsx"]));
    expect(plan.run.at(-1)).toEqual({ gate: GATE.e2e, command: `${COMMAND.e2e} 'e2e/auth.spec.ts'` });
    expect(plan.skip).toEqual([]);
  });

  it("a docs-only change runs typecheck alone and skips lint and tests with a reason", () => {
    const plan = lean(planChanged(tree(), ["docs/ci/pipelines.md"]));
    expect(gates(plan)).toEqual([GATE.typecheck]);
    expect(plan.skip.map((skip) => skip.reason)).toEqual([SKIP_REASON.noCode, SKIP_REASON.noModule, SKIP_REASON.noSpec]);
  });

  it("a changed JSON file runs the unit tests that import it, but is not handed to the linter, which reads TypeScript only", () => {
    const plan = lean(planChanged(tree({ "app/locales/en/common.json": "{}\n" }), ["app/locales/en/common.json"]));
    expect(plan.run.map((step) => step.command)).toEqual([COMMAND.typecheck, `${COMMAND.test} 'app/locales/en/common.json'`]);
    expect(plan.skip.map((skip) => skip.gate)).toEqual([GATE.lint, GATE.e2e]);
  });

  it("a deleted file is not handed to the linter or vitest: both fail on a path that does not exist", () => {
    const plan = lean(planChanged(tree(), ["app/lib/gone.ts", "app/lib/sum.ts"]));
    expect(plan.run.map((step) => step.command).join("\n")).not.toContain("gone.ts");
  });

  it("no change at all still typechecks", () => {
    expect(gates(planChanged(tree(), []))).toEqual([GATE.typecheck]);
  });

  it("a gate script in the diff falls back to every gate, whatever else changed", () => {
    const plan = planChanged(tree(), ["app/lib/sum.ts", "bun.lock", "bun.lock"]);
    expect(plan).toEqual({ kind: "full", reasons: ["bun.lock: the lockfile"] });
  });

  it("a test map that does not parse falls back to every gate: the specs cannot be chosen", () => {
    const repo = memoryRepo({ "scripts/lint/test-map.json": "{", "app/lib/sum.ts": "export const a = 1;\n" });
    expect(planChanged(repo, ["app/lib/sum.ts"])).toEqual({ kind: "full", reasons: [NO_MAP_REASON] });
  });
});

describe("shellQuote", () => {
  it.each([
    ["app/lib/sum.ts", "'app/lib/sum.ts'"],
    ["app/routes/api/trpc.$.ts", "'app/routes/api/trpc.$.ts'"],
    ["it's.ts", "'it'\\''s.ts'"],
  ])("%s -> %s: bash -c must see one word, with no $ expanded", (path, quoted) => {
    expect(shellQuote(path)).toBe(quoted);
  });
});

describe("renderPlan", () => {
  it("prints a lean plan as run and skip lines in the format verify.sh reads", () => {
    const plan: Plan = { kind: "lean", run: [{ gate: "typecheck", command: "bun run typecheck" }], skip: [{ gate: "e2e", reason: "no spec" }] };
    expect(renderPlan(plan)).toEqual(["run|typecheck|bun run typecheck", "skip|e2e|no spec"]);
  });

  it("prints a full plan as one full line per reason", () => {
    expect(renderPlan({ kind: "full", reasons: ["a", "b"] })).toEqual(["full|a", "full|b"]);
  });
});
