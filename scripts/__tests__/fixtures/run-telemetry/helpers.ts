import type { Deps, Outcome } from "../../../run-telemetry";
import { ledgerChecksum, type LedgerCall } from "../../../lib/run-telemetry";

export const ROOT = "/repo";
export const RUN_PATH = `${ROOT}/.verify/demo/run.json`;

export function memory(files: Record<string, string> = {}, stdin = "") {
  const store = new Map(Object.entries(files));
  const writes: string[] = [];
  const deps: Deps = {
    root: ROOT,
    readStdin: () => stdin,
    readFile: (path) => store.get(path) ?? null,
    writeFile: (path, text) => {
      writes.push(path);
      store.set(path, text);
    },
    mkdirp: () => undefined,
    listDir: (path) => {
      const prefix = `${path}/`;
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split("/")[0] ?? "");
      return [...new Set(names)];
    },
  };
  return { deps, store, writes };
}

export const call = (over: Partial<LedgerCall> = {}): LedgerCall => ({
  label: "audit",
  phase: "Audit",
  agent: "ticket-auditor",
  model: "",
  attempt: 1,
  outcome: "ok",
  verdict: "ready",
  ...over,
});

export function ledgerText(calls: LedgerCall[], tamper?: { check?: string; count?: number }): string {
  const lines = calls.map((c) => JSON.stringify([c.label, c.phase, c.agent, c.model, c.attempt, c.outcome, c.verdict]));
  const footer = JSON.stringify({ calls: tamper?.count ?? lines.length, check: tamper?.check ?? ledgerChecksum(lines.join("\n")) });
  return `${[...lines, footer].join("\n")}\n`;
}

export const text = (o: Outcome) => o.stdout.join("\n");
export const err = (o: Outcome) => o.stderr.join("\n");

export function runFile(workflows: Record<string, unknown[]>, slug = "demo"): string {
  return JSON.stringify({ version: 1, slug, workflows: Object.fromEntries(Object.entries(workflows).map(([k, calls]) => [k, { calls }])) });
}

export const stored = (n: number, over: Record<string, unknown> = {}) => ({
  n,
  label: "audit",
  phase: "Audit",
  agent: "ticket-auditor",
  model: "",
  attempt: 1,
  outcome: "ok",
  verdict: "",
  tokens: null,
  seconds: null,
  ran_model: null,
  ...over,
});

export const tokens = (input: number, output: number) => ({ in: input, out: output, cache_read: 0, cache_write: 0 });

export const journal = (lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
export const assistant = (id: string, usage: Record<string, number>, at: string, model = "claude-sonnet-5-5") => ({
  type: "assistant",
  timestamp: at,
  message: { id, model, usage },
});

export const DIR = "/runs/r1";
