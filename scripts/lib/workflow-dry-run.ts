/**
 * Dry-run a workflow script (.claude/workflows/<name>.js): run its body with `agent()` replaced by
 * scripted answers, so a test can drive every branch without a model call.
 *
 * It copies the Workflow runtime where a script can tell the difference:
 *   - `agent(prompt, opts)` returns the scripted answer; one with `opts.schema` is checked against it.
 *   - `parallel` and `pipeline` turn a throw into null, like the runtime.
 *   - `Date.now()`, `Date()` and `new Date()` with no argument, and `Math.random()` throw: they would break resume.
 *   - `resumeFrom` replays a stopped run: agent calls return their old result for as long as the
 *     prompt and opts match, call by call. The first call that differs, and every one after, is live.
 *
 * A run with an agent call no rule answers, or an answer its schema rejects, fails after the script
 * ends, even when the script caught the error (twice() and parallel() both swallow throws).
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface AgentOpts {
  label?: string;
  phase?: string;
  schema?: unknown;
  model?: string;
  effort?: string;
  isolation?: string;
  agentType?: string;
}

export interface AgentCall {
  /** 0-based position among this run's agent calls. */
  n: number;
  prompt: string;
  opts: AgentOpts;
  /** opts.label, or "" when the call has none. */
  label: string;
  /** opts.phase, else the last phase() title. */
  phase: string | null;
  /** True when the result came from `resumeFrom`, not from a rule. */
  cached: boolean;
  result: unknown;
}

/** What an answer function sees: the call, and how many calls this rule has answered before it. */
export type AnswerInput = Omit<AgentCall, "cached" | "result"> & { nth: number };
type Answer = unknown | ((call: AnswerInput) => unknown);
/** A string matches the whole label; a RegExp tests the label; a function sees the call. */
type Matcher = string | RegExp | ((call: Omit<AnswerInput, "nth">) => boolean);
/** `[matcher, answer]`. The first rule that matches answers. Answer `null` is an agent that died. */
export type AnswerRule = [Matcher, Answer];

interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: { title: string; detail?: string; model?: string }[];
}

export interface DryRunOptions {
  args?: unknown;
  answers: AnswerRule[];
  /** A run that stopped. Its calls replay from cache while prompt and opts are unchanged. */
  resumeFrom?: DryRunResult;
  /** Script path. Default: .claude/workflows/<name>.js in this repo. */
  file?: string;
}

export interface DryRunResult {
  meta: WorkflowMeta;
  /** What the script returned. */
  result: unknown;
  /** Every agent call, in call order. */
  calls: AgentCall[];
  /** The calls a rule answered (not replayed from `resumeFrom`). */
  live: AgentCall[];
  logs: string[];
  /** phase() titles, in order. */
  phases: string[];
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The runtime's backstop against a runaway loop. */
const MAX_AGENTS = 1000;

/** Answers in turn: the first call gets `answers[0]`, the next `answers[1]`; the last one repeats. */
export const seq =
  (...answers: unknown[]): ((call: AnswerInput) => unknown) =>
  (call) => {
    const a = answers[Math.min(call.nth, answers.length - 1)];
    return typeof a === "function" ? a(call) : a;
  };

/** Labels of calls, for short assertions. */
export const labels = (calls: AgentCall[]): string[] => calls.map((c) => c.label);

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: unknown[];
};

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;

/** The JSON Schema keywords the workflows use: type, properties, required, additionalProperties, items, enum. */
export function schemaErrors(schema: unknown, value: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as Schema;
  const errors: string[] = [];
  if (s.type !== undefined) {
    const want = Array.isArray(s.type) ? s.type : [s.type];
    const got = typeOf(value);
    if (!want.includes(got) && !(got === "integer" && want.includes("number"))) {
      return [`${path}: want ${want.join("|")}, got ${got}`];
    }
  }
  if (s.enum && !s.enum.some((e) => e === value))
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.enum)}`);
  if (typeOf(value) === "object") {
    const o = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) errors.push(`${path}.${k}: required`);
    for (const [k, v] of Object.entries(o)) {
      const sub = s.properties?.[k];
      if (sub) errors.push(...schemaErrors(sub, v, `${path}.${k}`));
      else if (s.additionalProperties === false) errors.push(`${path}.${k}: not in the schema`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object")
        errors.push(...schemaErrors(s.additionalProperties, v, `${path}.${k}`));
    }
  }
  if (Array.isArray(value) && s.items)
    value.forEach((v, i) => {
      errors.push(...schemaErrors(s.items, v, `${path}[${i}]`));
    });
  return errors;
}

const banned = (what: string) => () => {
  throw new Error(`${what} is not available in a workflow script: it would break resume`);
};
const GuardedDate = new Proxy(Date, {
  apply: banned("Date()"),
  construct: (target, argv) =>
    argv.length ? new target(...(argv as [number])) : banned("new Date()")(),
  get: (target, key, receiver) =>
    key === "now" ? banned("Date.now()") : Reflect.get(target, key, receiver),
});
const GuardedMath = Object.create(Math, { random: { value: banned("Math.random()") } });

const matches = (m: Matcher, call: Omit<AnswerInput, "nth">): boolean =>
  typeof m === "string" ? m === call.label : m instanceof RegExp ? m.test(call.label) : m(call);

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...a: string[]
) => (...a: unknown[]) => Promise<unknown>;

/** Run the workflow `name` with scripted agents. Rejects when the script throws or an agent call went unanswered. */
export async function dryRun(name: string, options: DryRunOptions): Promise<DryRunResult> {
  // WORKFLOW_DRY_RUN_DIR=<dir>: read the scripts from there, to test a build before it replaces the live ones.
  const file =
    options.file ??
    join(process.env.WORKFLOW_DRY_RUN_DIR ?? join(REPO_ROOT, ".claude", "workflows"), `${name}.js`);
  const source = readFileSync(file, "utf8");
  if (!/^export const meta = /.test(source))
    throw new Error(`${file}: a workflow script must begin with "export const meta = "`);
  const metaBox: { value?: WorkflowMeta } = {};
  const body = source.replace(/^export const meta = /, "const meta = __meta.value = ");

  const calls: AgentCall[] = [];
  const logs: string[] = [];
  const phases: string[] = [];
  const problems: string[] = [];
  const answered = new Map<AnswerRule, number>();
  const old = options.resumeFrom?.calls ?? [];
  let replaying = old.length > 0;
  let currentPhase: string | null = null;

  const agent = async (prompt: string, opts: AgentOpts = {}): Promise<unknown> => {
    if (typeof prompt !== "string") throw new Error("agent(prompt): prompt must be a string");
    if (calls.length >= MAX_AGENTS)
      throw new Error(`more than ${MAX_AGENTS} agent calls: runaway loop`);
    const n = calls.length;
    const head = { n, prompt, opts, label: opts.label ?? "", phase: opts.phase ?? currentPhase };
    const call: AgentCall = { ...head, cached: false, result: null };
    calls.push(call);

    const prev = old[n];
    if (
      replaying &&
      prev &&
      prev.result !== null &&
      prev.prompt === prompt &&
      JSON.stringify(prev.opts) === JSON.stringify(opts)
    ) {
      call.cached = true;
      call.result = structuredClone(prev.result);
      return call.result;
    }
    replaying = false;

    const rule = options.answers.find(([m]) => matches(m, head));
    if (!rule) {
      const msg = `no scripted answer for agent call ${n} (label ${JSON.stringify(head.label)}, agentType ${opts.agentType ?? "none"}, phase ${head.phase})`;
      problems.push(msg);
      throw new Error(`dry run: ${msg}`);
    }
    const nth = answered.get(rule) ?? 0;
    answered.set(rule, nth + 1);
    const answer =
      typeof rule[1] === "function"
        ? await (rule[1] as (c: AnswerInput) => unknown)({ ...head, nth })
        : rule[1];
    const result = answer === undefined ? null : structuredClone(answer);
    if (result !== null && opts.schema) {
      const errors = schemaErrors(opts.schema, result);
      if (errors.length) {
        const msg = `the answer for ${JSON.stringify(head.label)} (call ${n}) does not fit its schema: ${errors.slice(0, 5).join("; ")}`;
        problems.push(msg);
        throw new Error(`dry run: ${msg}`);
      }
    }
    call.result = result;
    return result;
  };

  const settle = async (fn: () => unknown): Promise<unknown> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };
  const parallel = (thunks: (() => unknown)[]) => Promise.all(thunks.map((t) => settle(t)));
  const pipeline = (
    items: unknown[],
    ...stages: ((prev: unknown, item: unknown, i: number) => unknown)[]
  ) =>
    Promise.all(
      items.map((item, i) =>
        settle(async () => {
          let prev: unknown = item;
          for (const stage of stages) prev = await stage(prev, item, i);
          return prev;
        }),
      ),
    );
  const phase = (title: string) => {
    currentPhase = title;
    phases.push(title);
  };
  const log = (message: unknown) => void logs.push(String(message));
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const workflow = () => {
    throw new Error("dry run: workflow() is not stubbed");
  };

  const run = new AsyncFunction(
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "args",
    "budget",
    "workflow",
    "Date",
    "Math",
    "__meta",
    body,
  );
  let result: unknown;
  let thrown: unknown;
  try {
    result = await run(
      agent,
      parallel,
      pipeline,
      phase,
      log,
      options.args,
      budget,
      workflow,
      GuardedDate,
      GuardedMath,
      metaBox,
    );
  } catch (e) {
    thrown = e;
  }
  // WORKFLOW_DRY_RUN_TRACE=<file>: append this run (every prompt, opts, log line and the result) as one
  // JSON line. Diff two trace files to prove an edit to a workflow changed no prompt.
  const traceFile = process.env.WORKFLOW_DRY_RUN_TRACE;
  if (traceFile) {
    const trace = {
      name,
      args: options.args,
      calls: calls.map(({ prompt, opts, cached, result: r }) => ({
        prompt,
        opts,
        cached,
        result: r,
      })),
      logs,
      phases,
      result,
      threw: thrown ? String(thrown) : null,
    };
    appendFileSync(traceFile, `${JSON.stringify(trace)}\n`);
  }
  if (problems.length) {
    const after = thrown
      ? `\n  then the script threw: ${thrown instanceof Error ? thrown.message : JSON.stringify(thrown)}`
      : "";
    throw new Error(
      `dry run of ${name}: ${problems.length} problem(s):\n  ${problems.join("\n  ")}${after}`,
    );
  }
  if (thrown) throw thrown;
  if (!metaBox.value) throw new Error(`${file}: meta was never set`);
  return { meta: metaBox.value, result, calls, live: calls.filter((c) => !c.cached), logs, phases };
}
