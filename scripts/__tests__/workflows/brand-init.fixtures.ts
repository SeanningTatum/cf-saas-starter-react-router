import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { configLine, dryRun, RUN_OK, type AgentCall, type AnswerInput, type AnswerRule, type DryRunResult } from "../../lib/workflow-dry-run";

/** The workflow returns untyped JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;

export const ROOT = "/work/acme";
export const OUT = `${ROOT}/.verify/brand-init`;
export const UI_DIR = fileURLToPath(new URL("../../../app/components/ui", import.meta.url));

export const ANSWERS = { users: "Studio owners who bill by the hour" };
/** Args that settle both the brief and the pick, so a run goes straight to Contract. */
export const SHIP_ARGS = { answers: ANSWERS, pick: 2, rebuildHome: true };

export const run = (args: unknown, answers: AnswerRule[], resumeFrom?: DryRunResult) => dryRun("brand-init", { args, answers, resumeFrom });
export const res = (r: DryRunResult) => r.result as Obj;
export const byLabel = (r: DryRunResult, label: string) => r.calls.filter((c) => c.label === label);
export const one = (r: DryRunResult, label: string): AgentCall => {
  const found = byLabel(r, label);
  expect(found, `exactly one call labelled ${label}`).toHaveLength(1);
  return found[0];
};
export const indexOf = (r: DryRunResult, label: string) => r.calls.findIndex((c) => c.label === label);

/** The `  · path` lines under a prompt's FILE FENCE header: the paths that lane is held to. */
export function fenceIn(prompt: string): string[] {
  const after = prompt.split("FILE FENCE")[1];
  if (!after) return [];
  const out: string[] = [];
  for (const line of after.split("\n").slice(1)) {
    const m = /^\s+· (\S+)$/.exec(line);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
}
export const fileIn = (fence: string) => (fence.endsWith("/**") ? `${fence.slice(0, -2)}index.tsx` : fence);
/** A lane that edited the first file of its own fence. */
export const laneDid = (c: AnswerInput, files = [fileIn(fenceIn(c.prompt)[0])]) => ({ files, report: `${c.label}: done`, cwd: ROOT });

export const idOf = (label: string) => Number(label.split(":")[1]);
export const tokensFor = (id: number, stage: "drawn" | "tasted") => ({
  name: `Comp ${id} ${stage}`,
  light: { primary: `oklch(0.5 0.2 ${id * 90})` },
  dark: { primary: `oklch(0.7 0.2 ${id * 90})` },
  voice: [`Voice of comp ${id}`],
});

export const QUESTIONS = [
  { id: "users", question: "Who uses it?", draft: "Small teams", confident: false },
  { id: "tone", question: "What tone?", draft: "Calm and exact", confident: true },
];
export const PASS = { verdict: "PASS", findings: [], evidence: "all green" };
export const SHIPPED = { shipped: true, gatesGreen: true, verdictWritten: true, commit: "abc1234", pr: "https://github.com/acme/app/pull/7" };

/** The happy path. Overrides go first, because the first matching rule answers. */
export function rules(overrides: AnswerRule[] = []): AnswerRule[] {
  return [
    ...overrides,
    ["preflight", { ok: true, reason: "", branch: "feat/brand-init", root: ROOT, config_json: configLine() }],
    [/^run:record/, RUN_OK],
    ["memory:recall", "nothing recorded"],
    [/^memory:record:/, (c: AnswerInput) => `recorded ${c.label}`],
    ["brief:interview", { questions: QUESTIONS }],
    ["brief:write", { oneLine: "Invoicing for small studios", sector: "saas" }],
    [
      /^draw:directions:\d+$/,
      (c: AnswerInput) => {
        const first = Number(c.label.split(":")[2]);
        const ids = [first, first + 1, first + 2];
        return { drawIds: ids.map((i) => `dir-${i}`), directions: ids.map((id) => ({ id, sheet: `${OUT}/directions/${id}.md` })) };
      },
    ],
    [
      /^draw:\d+(:redraw)?$/,
      (c: AnswerInput) => {
        const id = idOf(c.label);
        const dir = `${OUT}/${id}${c.label.endsWith(":redraw") ? "-r" : ""}`;
        return { html: `${dir}/comp.html`, tokens: tokensFor(id, "drawn"), screenshots: [`${dir}/shots/mobile-light.png`, `${dir}/shots/desktop-light.png`] };
      },
    ],
    [/^critique:\d+:taste(:redraw)?$/, (c: AnswerInput) => ({ score: 8, notes: "hero type tightened", tokens: tokensFor(idOf(c.label), "tasted") })],
    [/^critique:\d+:impeccable(:redraw)?$/, { findings: [], contrastAA: { light: true, dark: true } }],
    [/^critique:\d+:motion(:redraw)?$/, { verdict: "PASS", notes: "eases out, reduced motion collapses" }],
    ["critique:sameness", { pairs: [] }],
    ["contract:snapshot", { paths: ["PRODUCT.md"] }],
    ["contract:tokens", { files: ["app/app.css", "app/root.tsx"], report: "contrast: muted-foreground L 0.55 -> 0.50", cwd: ROOT }],
    ["build:fence-diff", { paths: ["PRODUCT.md", "app/app.css"] }],
    ["build:polish", { files: [], report: "polish: nothing to change", cwd: ROOT }],
    [/^build:/, (c: AnswerInput) => laneDid(c)],
    [/^check:/, PASS],
    [/^fix:\d+:repair:/, { files: [], reverted: [], report: "repair: nothing reverted", cwd: ROOT }],
    [/^fix:\d+:revert-strays$/, { files: [], reverted: [], report: "nothing reverted", cwd: ROOT }],
    [/^fix:\w+:orphans$/, { files: [], report: "orphans: nothing changed", cwd: ROOT }],
    [/^fix:/, (c: AnswerInput) => laneDid(c)],
    ["close:design-md", { written: true, files: ["DESIGN.md"] }],
    ["close:synthesis", "STATE: brand applied. BLOCKING: none."],
    ["ship:record-commit-pr", SHIPPED],
  ];
}
