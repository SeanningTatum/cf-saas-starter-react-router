/**
 * The helpers every workflow shares; scripts/workflows.ts pastes this file into each workflow.
 * Rules for an author:
 *   - no import, and no free variable except a JS built-in: whatever needs the runtime comes in
 *     through `workflowLib({ agent, log })`;
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
/** The trailer on every commit a workflow asks an agent to make. Written here and nowhere else. */
export const COAUTHOR = "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>";
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

// ---- Helpers that need the runtime ----------------------------------------------------------------
export function workflowLib({ agent, log }) {
  /** Run an agent thunk; one retry if it returns nothing or throws. Returns null after two failures. */
  async function twice(fn, what) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fn(attempt);
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
    const ask = (prompt, opts) => agent(`${preamble}\n\n${prompt}`, opts);
    const sh = (prompt, opts) => ask(prompt, { effort: "low", ...opts, agentType: "runner" });
    const remember = async (slug, fields, label, phaseName) => {
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

  return { twice, checkArgs, asker, preflightFault };
}
