import { configLine, RUN_OK, type AnswerInput, type AnswerRule } from "../../lib/workflow-dry-run";

export const ROOT = "/work/repo";
export const SLUG = "demo-widget";
export const BASE_SHA = "a".repeat(40);
export const REVIEWED_SHA = "c".repeat(40);
export const ISSUE_URL = "https://github.com/o/r/issues/76";
export const PR1 = {
  n: 1,
  branch: `feat/${SLUG}/1-data`,
  base: "staging",
  title: "Widget data",
  fence: ["app/repositories/widget.ts", "app/repositories/__tests__/widget.test.ts"],
  greptile_focus: "authorization",
};
export const PR2 = {
  n: 2,
  branch: `feat/${SLUG}/2-ui`,
  base: PR1.branch,
  title: "Widget screen",
  fence: ["app/routes/widget.tsx"],
  greptile_focus: "empty and error states",
};
export const CONTRACT = "export type Widget = { id: string; name: string }";
export const ARGS = { ticket: "76" };

export const GITHUB_WRITE = /git push|gh pr (create|comment|merge|edit|review|close|ready)|gh issue (create|comment|edit|close)|gh api|@greptileai review/;

export const GATES = [
  { name: "typecheck", pass: true, tail: "" },
  { name: "unit", pass: true, tail: "" },
  { name: "e2e", pass: true, tail: "" },
];
export const PASS = { verdict: "PASS", findings: [], evidence: "" };
const LANE_OK = (path: string) => ({ files: [{ path, summary: "done" }], typecheck: "pass", blocked: [] });

export const CONFIG_OK = { ok: true, reason: "", config_json: configLine() };

export const preflight = (over: Record<string, unknown> = {}) => ({
  ok: true,
  reason: "",
  root: ROOT,
  date: "2026-11-22",
  untracked: [],
  base_branch: "staging",
  base_sha: BASE_SHA,
  issue: { ref: "#76", url: ISSUE_URL, title: "Demo widget", body: "Let users add widgets." },
  record_path: `${ROOT}/.verify/_intake/record-76.md`,
  has_analytics: false,
  has_codegraph: false,
  moved_nested_modules: false,
  baseline: GATES,
  ...over,
});

export const PLAN = {
  slug: SLUG,
  title: "Demo widget",
  summary: "Users add and list widgets.",
  ui: true,
  surface: "app",
  prototype: "",
  metric: "",
  acceptance: ["The list shows an empty state"],
  golden_path: "Open /widgets and add one",
  error_path: "A duplicate name shows an error",
  contract: CONTRACT,
  seed_fixtures: ["one widget"],
  prs: [PR1, PR2],
};

export function happy(over: AnswerRule[] = []): AnswerRule[] {
  return [
    ...over,
    ["config", CONFIG_OK],
    ["preflight", preflight()],
    ["intake:record", PLAN],
    ["contract:branch", { ok: true, reason: "" }],
    ["contract:map", { files: [] }],
    ["contract:schema", LANE_OK(`app/lib/schemas/${SLUG}.ts`)],
    [/^build:pr\d+-(backend|ui)$/, (c: AnswerInput) => LANE_OK(c.label)],
    [/^build:typecheck:/, { pass: true, errors: [] }],
    ["write:impact", { changed: [], dependents: [] }],
    ["write:unit", "tests written"],
    ["write:e2e", { specs: [{ path: `e2e/${SLUG}.spec.ts`, regression: "golden path" }], run: { passed: 2, failed: 0, tail: "" }, skipped: [] }],
    ["write:instrument", { events: [], files: [], skipped: [], spans: ["spans added"] }],
    ["review:paths", { files: ["app/repositories/widget.ts", "app/routes/widget.tsx"] }],
    [/^review:gates:/, { gates: GATES }],
    [/^review:(effect|security|scale|lean|walk|critique):/, PASS],
    [
      "docs",
      {
        files: ["GLOSSARY.md"],
        pr_bodies: [
          { n: 1, path: "pr-1.md" },
          { n: 2, path: "pr-2.md" },
        ],
        adr: null,
      },
    ],
    [
      /^ship:assign:/,
      {
        assignments: [
          { n: 1, branch: PR1.branch, paths: PR1.fence },
          { n: 2, branch: PR2.branch, paths: PR2.fence },
        ],
        unassigned: [],
        overlaps: [],
        excluded: [],
      },
    ],
    [/^ship:videos:/, { passed: true, videos: [{ kind: "golden", title: "adds a widget", path: "video/golden-1.webm", status: "passed" }], unrecorded: [] }],
    [/^run:record/, RUN_OK],
    [/^memory:/, "recorded"],
    [
      "split",
      {
        ok: true,
        failed_command: "",
        branches: [
          { n: 1, branch: PR1.branch, sha: "b1" },
          { n: 2, branch: PR2.branch, sha: "b2" },
        ],
        checks: [],
      },
    ],
    [/^local:code-review:/, { method: "code-review skill", findings: [] }],
    ["local:home", "switched"],
    [
      "open:prs",
      {
        ok: true,
        failed_command: "",
        prs: [
          { n: 2, number: 102, url: "https://github.com/o/r/pull/102", branch: PR2.branch },
          { n: 1, number: 101, url: "https://github.com/o/r/pull/101", branch: PR1.branch },
        ],
      },
    ],
    [/:checks$/, { prs: [{ number: 101, checks: [{ name: "ci", state: "SUCCESS" }] }], preview_url: "" }],
    ["rollup:pr", { ok: true, failed_command: "", merged: [101, 102], number: 103, url: "https://github.com/o/r/pull/103" }],
    ["rollup-greptile:trigger", { ok: true, failed_command: "" }],
    [/^rollup-greptile:wait:/, { status: "reviewed", sha: REVIEWED_SHA, confidence: 5, summary: "Looks good", comments: [] }],
  ];
}
