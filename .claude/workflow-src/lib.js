/**
 * The helpers every workflow shares; scripts/workflows.ts pastes this file into each workflow.
 * Rules for an author:
 *   - no import, and no free variable except a JS built-in: whatever needs the runtime comes in
 *     through `workflowLib({ agent, log, name })`;
 *   - every top-level name here lands in each workflow's scope, so a workflow must not declare it again.
 */

// ---- Schemas ------------------------------------------------------------------------------------
export const STR = { type: "string" };
export const NUM = { type: "number" };
export const BOOL = { type: "boolean" };
export const STRS = { type: "array", items: STR };
export const arr = (items) => ({ type: "array", items });
/** A closed object: every property required unless `required` lists some, no extra keys. */
export const obj = (properties, required) => ({ type: "object", required: required || Object.keys(properties), properties, additionalProperties: false });
/** An open object: extra keys allowed, and `required` is left out unless given. */
export const shape = (properties, required) => (required ? { type: "object", properties, required } : { type: "object", properties });

/** A branch name or slug: lower-case words joined by single hyphens. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The ticket-auditor's fixed checklist: one item per id, in this order. */
export const CHECKLIST_IDS = ["problem", "user", "fit", "duplicate", "acceptance", "non_goals", "metric", "ui_states", "data", "roles", "i18n_analytics", "errors", "non_negotiables"];

// ---- Findings -----------------------------------------------------------------------------------
/** True for a finding that blocks: P0 or P1. */
export const isP0P1 = (f) => f.severity === "P0" || f.severity === "P1";

// ---- Prompt pieces ------------------------------------------------------------------------------
/** Makes a `fence(label, text)` that wraps untrusted text in DATA markers; `note` goes after the label on the opening marker. */
export const makeFence = (note = "") => (label, text) => `----- DATA: ${label}${note} -----\n${text}\n----- END DATA: ${label} -----`;
/** The preflight step that names the checkout: the caller's `args.root`, else the launch directory's git root. */
export const rootClause = (root) =>
  typeof root === "string"
    ? `The caller gave root ${JSON.stringify(root)}. Run \`git -C <that> rev-parse --is-inside-work-tree\`; it must print true, else fail with "args.root is not a git work tree". ROOT is \`git -C <that> rev-parse --show-toplevel\`.`
    : "Run `git rev-parse --show-toplevel` in your starting directory. That is ROOT. Do not look for another checkout or a .claude/worktrees/* tree.";

// ---- Args and stops -------------------------------------------------------------------------------
/**
 * A string is a ticket ref (12, #12, an issue URL) or else free text under `textKey`; an object is
 * the args as given; anything else (an array, null, a number) is null.
 */
export function parseArgs(args, textKey) {
  if (typeof args === "string") {
    const s = args.trim();
    return /^(#?\d+|https?:\/\/\S+)$/.test(s) ? { ticket: s } : { [textKey]: s };
  }
  return args && typeof args === "object" && !Array.isArray(args) ? args : null;
}

/**
 * HOW THE HUMAN STEPS WORK (plan-feature, ship-feature, brand-init)
 *   Agents inside a workflow cannot chat with the user, and a script has no ask-the-user call. So
 *   when the run needs an answer it STOPS and RETURNS what it needs, as { status: "needs-...", ... }.
 *   The main thread asks the user, then runs the workflow again with the answer added to `args` and
 *   `resumeFromRunId` set to the stopped run's id: every agent that already finished returns its
 *   cached result, so the run picks up where it stopped. Keep every other arg the same on the re-run.
 *   Each stop first records where it stopped in the working memory (`remember`, below).
 *
 *   A stop about words is asked in chat. A stop about something to look at also returns `review`: an
 *   HTML page path under .verify/<slug>/ for the main thread to write, open with lavish
 *   (`npx -y lavish-axi <page>`) and long-poll (`npx -y lavish-axi poll <page>`) for the answer. The
 *   `next` field says what goes on the page. If lavish will not start, ask in chat instead. Never run
 *   `lavish-axi share`: it publishes to a third-party host.
 *
 * A stop RETURNS what the run needs by throwing `{ halt: result }` to unwind to the `catch` at the
 * bottom of the script, which hands the throw here: a halt becomes the return value, anything else
 * is a real error and rethrown.
 */
export function haltOrThrow(e) {
  if (e && e.halt) return e.halt;
  throw e;
}

// ---- Working memory -------------------------------------------------------------------------------
/**
 * The shell command that merges one record into the working memory (scripts/memory.ts reads the
 * fields from stdin, one `key: value` per line). `fields` maps a key to a string or a list of
 * strings: status, issue, context, log, stopped, waiting, next, decision, link, todo, done. Empty
 * values are left out, and each value is flattened to one line, so text from a ticket cannot end
 * the heredoc or add a field.
 */
export function memoryRecordCommand(slug, fields) {
  const oneLine = (v) => String(v).replace(/\s*[\r\n]+\s*/g, " ").split("MEMORY_EOF").join("MEMORY-EOF");
  const lines = Object.entries(fields).flatMap(([key, value]) =>
    [value].flat().filter((v) => v !== undefined && v !== null && v !== "").map((v) => `${key}: ${oneLine(v)}`)
  );
  return `bun scripts/memory.ts record ${slug} <<'MEMORY_EOF'\n${lines.join("\n")}\nMEMORY_EOF`;
}

// ---- Run telemetry ----------------------------------------------------------------------------------
/** FNV-1a, 32 bit, over the UTF-16 code units of `text`, as 8 lower-case hex digits. scripts/run-telemetry.ts computes the same sum. */
export function ledgerChecksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A short verdict for the ledger: the result's `verdict` string, else pass or fail from its first boolean among ok, pass, passed, else "". */
export function verdictOf(result) {
  if (!result || typeof result !== "object") return "";
  if (typeof result.verdict === "string") return result.verdict;
  for (const k of ["ok", "pass", "passed"]) if (typeof result[k] === "boolean") return result[k] ? "pass" : "fail";
  return "";
}

/** The most characters one ledger string keeps; agent output can reach a ledger string, so each is cut and stripped to a safe set. */
export const LEDGER_FIELD_MAX = 80;

/**
 * The shell command that hands the ledger to scripts/run-telemetry.ts: one JSON array per call, then a
 * line with the call count and a checksum, so a runner that garbled the copy leaves nothing behind.
 * A script has no clock and no file access, so this is how a run reports its calls.
 */
export function runRecordCommand(workflow, slug, calls) {
  const clean = (v) => String(v).replace(/[^A-Za-z0-9 :._/#()-]/g, "-").slice(0, LEDGER_FIELD_MAX).split("RUN_EOF").join("RUN-EOF");
  const lines = calls.map((c) => JSON.stringify([clean(c.label), clean(c.phase), clean(c.agent), clean(c.model), c.attempt, clean(c.outcome), clean(c.verdict)]));
  const footer = JSON.stringify({ calls: lines.length, check: ledgerChecksum(lines.join("\n")) });
  return `bun scripts/run-telemetry.ts record ${slug} ${workflow} <<'RUN_EOF'\n${[...lines, footer].join("\n")}\nRUN_EOF`;
}

/** The sentence a stop that returns a `review` page adds to its `next`: the page shows the run's numbers too. */
export const runSummaryNote = (slug, workflow) =>
  `The page also shows the run summary: the output of \`bun scripts/run-telemetry.ts summary ${slug}\`, run from ROOT. Tokens and seconds read n/a until \`bun scripts/run-telemetry.ts ingest ${slug} ${workflow} <this run's transcript directory>\` has run; run it first when you have the directory.`;

// ---- Project config -----------------------------------------------------------------------------------
/** JSON with object keys sorted at every depth and no whitespace. scripts/lib/harness-config.ts computes the same text. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  const text = JSON.stringify(value);
  return text === undefined ? "null" : text;
}

/** The sentence a run stops with when the config line a runner copied does not check out. */
export const CONFIG_COPY_FAULT = "the config copy did not verify; run the workflow again";

/**
 * Parses the one line `bun scripts/harness-config.ts show` prints ({ config, check }) and verifies it: the
 * checksum is recomputed over the stable JSON of `config`, so a runner that garbled the copy is caught.
 * `need` lists dotted keys the workflow cannot run without. Returns { config } or { error }.
 */
export function readConfig(configJson, need) {
  let parsed;
  try {
    parsed = JSON.parse(configJson);
  } catch {
    return { error: `${CONFIG_COPY_FAULT} (not JSON)` };
  }
  if (!parsed || typeof parsed !== "object" || !parsed.config || typeof parsed.config !== "object" || typeof parsed.check !== "string") {
    return { error: `${CONFIG_COPY_FAULT} (no config or check)` };
  }
  if (ledgerChecksum(stableJson(parsed.config)) !== parsed.check) return { error: `${CONFIG_COPY_FAULT} (checksum differs)` };
  for (const key of need || []) {
    const value = key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), parsed.config);
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      return { error: `harness-config: set ${key} in harness.config.json` };
    }
  }
  return { config: parsed.config };
}

/** "a", "a and b", "a, b and c". */
export const andList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** A string as a regular expression's source, matched literally. */
export const reEscape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// ---- Helpers that need the runtime ----------------------------------------------------------------
export function workflowLib({ agent, log, name }) {
  // Every agent call goes through `tracked`, which keeps one ledger entry per call. The entry is
  // pushed when the call starts (so the ledger is in call order) and filled in when it settles.
  const entries = [];
  let attemptNo = 1;

  function tracked(prompt, opts) {
    const o = opts || {};
    const entry = { label: o.label || "", phase: o.phase || "", agent: o.agentType || "", model: o.model || "", attempt: attemptNo, outcome: "", verdict: "" };
    entries.push(entry);
    let pending;
    try {
      pending = agent(prompt, opts);
    } catch (e) {
      entry.outcome = "threw";
      throw e;
    }
    return Promise.resolve(pending).then(
      (r) => {
        entry.outcome = r === null || r === undefined ? "empty" : "ok";
        entry.verdict = verdictOf(r);
        return r;
      },
      (e) => {
        entry.outcome = "threw";
        throw e;
      }
    );
  }

  const ledger = () => entries.filter((e) => e.outcome).map((e) => ({ ...e }));

  /**
   * Has the runner write the ledger (scripts/run-telemetry.ts). A failed write is logged and changes
   * nothing else. The command holds only values the run already has, so a resumed run replays it from cache.
   */
  async function recordRun(slug, label, phaseName, send, where) {
    if (!SLUG.test(slug) || !SLUG.test(name)) {
      log("Memory and run ledger: not written, slug is not kebab-case");
      return null;
    }
    let out = null;
    let why = "the runner returned nothing";
    try {
      out = await send(`Run this command from ${where} exactly as written and return what it prints. Change nothing in it and run nothing else.\n\n${runRecordCommand(name, slug, ledger())}`, { label, phase: phaseName });
      if (out !== null && out !== undefined) why = String(out).slice(0, 200);
    } catch (e) {
      why = `the runner threw: ${e && e.message ? e.message : e}`.slice(0, 200);
    }
    if (!/run-telemetry: recorded/.test(String(out))) log(`Run telemetry: not recorded (${why})`);
    return out;
  }

  /**
   * Calls `fn()` so the agent call it makes shows in the ledger as attempt `n`. `fn` must make that
   * call before its first await: the number is set for that call only and put back before anything
   * else runs, so a parallel branch never reads this retry. A workflow that retries a call by hand
   * (not through `twice`) wraps the retry in `atAttempt(2, ...)`.
   */
  function atAttempt(n, fn) {
    const before = attemptNo;
    attemptNo = Math.max(before, n);
    try {
      return fn();
    } finally {
      attemptNo = before;
    }
  }

  /** Run an agent thunk; one retry if it returns nothing or throws. Returns null after two failures. */
  async function twice(fn, what) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await atAttempt(attempt, () => fn(attempt));
        if (r) return r;
      } catch (e) {
        log(`${what}: attempt ${attempt} threw — ${e && e.message ? e.message : e}`);
      }
      log(`${what}: attempt ${attempt} returned nothing`);
    }
    return null;
  }

  /**
   * Logs and returns `{ error }` for the first arg whose type is wrong, else null. `types` is a list
   * of [name, typeof]. `showGot` adds the offending value to the log line.
   */
  function checkArgs(who, types, input, showGot) {
    for (const [k, t] of types) {
      if (input[k] !== undefined && typeof input[k] !== t) {
        log(`${who}: args.${k} must be a ${t}${showGot ? `, got ${JSON.stringify(input[k])}` : ""}. Nothing ran.`);
        return { error: `args.${k} must be a ${t}` };
      }
    }
    return null;
  }

  /**
   * The ways a run talks to an agent once the checkout is known. Workflow agents start in the
   * launching session's cwd, which can be another checkout, so every prompt after Preflight opens
   * with `preamble`. `sh` is a shell-only step for the runner. `remember` and `recall` are the
   * working memory: the runner runs scripts/memory.ts, which merges the record or prints the brief,
   * so no model edits the store. A record holds only values the run already has (cached results,
   * args) and no clock, so a resumed run replays it from cache instead of writing twice.
   */
  function asker(preamble) {
    const ask = (prompt, opts) => tracked(`${preamble}\n\n${prompt}`, opts);
    const sh = (prompt, opts) => ask(prompt, { effort: "low", ...opts, agentType: "runner" });
    const remember = async (slug, fields, label, phaseName) => {
      // A slug or workflow name reaches a shell line below, so only a kebab-case one gets that far.
      if (!SLUG.test(slug) || !SLUG.test(name)) {
        log("Memory and run ledger: not written, slug is not kebab-case");
        return null;
      }
      // The ledger first, so the memory record that follows sees a file already written.
      const runLabel = label.startsWith("memory") ? `run:record${label.replace(/^memory(:record)?/, "")}` : `run:record:${label}`;
      await recordRun(slug, runLabel, phaseName, sh, "ROOT");
      const out = await sh(`Run this command from ROOT exactly as written and return what it prints. Change nothing in it and run nothing else.\n\n${memoryRecordCommand(slug, fields)}`, { label, phase: phaseName });
      // The script says so when a file has outgrown its limit; only a person can ask for the summary.
      if (/over 150 lines/.test(String(out))) log(`Memory: ${slug} is over 150 lines; ask context-memory to shorten it`);
      return out;
    };
    const recall = (what, label, phaseName) => sh(`Run \`bun scripts/memory.ts recall ${what}\` from ROOT and return what it prints. Change nothing.`, { label, phase: phaseName });
    return { ask, sh, remember, recall };
  }

  /**
   * Why a Preflight result ends the run (and the log line saying so), or null to go on: the runner
   * failed or returned nothing, or it found no absolute repo root. `callerRoot` is the args.root the
   * caller gave, if the workflow insists it be absolute too.
   */
  function preflightFault(pre, callerRoot) {
    if (!pre || !pre.ok) {
      const reason = pre ? pre.reason : "pre-flight agent returned nothing";
      log(`Pre-flight failed: ${reason}`);
      return reason;
    }
    if (typeof pre.root !== "string" || !pre.root.startsWith("/") || (typeof callerRoot === "string" && !callerRoot.startsWith("/"))) {
      log(`Pre-flight returned no absolute repo root (${JSON.stringify(pre.root)}). Nothing ran.`);
      return "preflight did not resolve an absolute repo root";
    }
    return null;
  }

  return { twice, atAttempt, checkArgs, asker, preflightFault, tracked, ledger, recordRun };
}
