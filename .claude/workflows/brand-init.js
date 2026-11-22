export const meta = {
  name: "brand-init",
  description:
    "Give a fork its own brand in one run — preflight, brief, three comps drawn and critiqued in parallel, your pick on a lavish review page, tokens and every primitive rebuilt on disjoint fences, checks, fix rounds, DESIGN.md, one commit and one PR",
  whenToUse:
    "A fresh fork that still wears the starter's look. Not for one colour or one component, not on a repo with live users whose brand is not changing (it rewrites every primitive), not as a throwaway exploration on a branch you care about.",
  phases: [
    { title: "Preflight", detail: "clean tree, green baseline, no brand yet, branch off main" },
    { title: "Brief", detail: "the impeccable init interview; asks you in chat, then writes PRODUCT.md" },
    { title: "Draw", detail: "taste draws the directions, then one comp lane per direction in parallel" },
    { title: "Critique", detail: "taste loop, impeccable critique, motion review per comp; sameness check; one redraw" },
    { title: "Pick", detail: "the run stops and returns the comps; you pick one (and answer the home question) on a lavish review page" },
    { title: "Contract", detail: "one lane writes tokens into the tokens file and the font link into the root layout" },
    { title: "Build", detail: "primitive and shared lanes own disjoint files and run concurrently; fence check; one polish pass so the first check wave covers it" },
    { title: "Check", detail: "design critiques, motion review, gates and a browser walk at once" },
    { title: "Fix", detail: "up to two rounds: owning lane per open finding, re-run every check the changes could affect; escalate the rest" },
    { title: "Close", detail: "DESIGN.md, fence check, synthesis" },
    { title: "Ship", detail: "verify gates, verdict file, one commit, one PR with the verdict in the body; no merge" },
  ],
};
// GENERATED, edit .claude/workflow-src/brand-init.js

/**
 * WHY THIS EXISTS
 *   A brand is chosen by looking at it, then applied everywhere at once. This is ONE self-contained
 *   workflow: there is no slash command in front of it. It draws three rival comps in parallel, lets
 *   critics judge them on pixels, asks the user to pick, then turns the winner into the real design
 *   system. The token layer is the one sequential step; after it, the primitives and a few shared
 *   components share no file, so they build in parallel. It ends by writing a verdict file
 *   and opening a PR with the verdict in its body, so everything lives in one place.
 *
 * HOW THE HUMAN STEPS WORK (the shared rules are in the library header below)
 *   The run stops with { status: "needs-input" | "needs-pick" | "needs-accept", ... }. needs-input is
 *   words, so it is asked in chat. needs-pick and needs-accept are about pixels, so the stop also
 *   returns `review`.
 *
 *     Workflow({ name: "brand-init", resumeFromRunId: "<runId of the stopped run>",
 *                args: { ...theSameArgs, answers: {...} } })        // after needs-input
 *     Workflow({ ..., args: { ...theSameArgs, answers, pick: 2, rebuildHome: true } })  // after needs-pick
 *     Workflow({ ..., args: { ...theSameArgs, answers, pick, accept: { "post-fix": true } } })  // after needs-accept
 *
 *   The three stops:
 *     needs-input  The Brief phase has open questions. Returns { status, questions: [{ id, question,
 *                  draft }] } where draft is the answer the run guessed from the repo. Re-run with
 *                  args.answers = { <id>: "<answer>" } (any id left out keeps its draft).
 *     needs-pick   Three comps are drawn and critiqued. Returns { status, round, comps: [{ id, name,
 *                  html, screenshot, tasteScore, pitch, ... }], needs: ["pick", "rebuildHome"], question }.
 *                  The comps are files the user can open (comp.html and screenshots under
 *                  .verify/brand-init/). Re-run with args.pick = <comp id> (or "none" to draw three
 *                  more; round 2 reads args.pick2 instead) and args.rebuildHome = true|false.
 *     needs-accept Findings survived the fix rounds. Returns { status, tag, why, items, evidence }.
 *                  Re-run with args.accept = { "<tag>": true } to ship with them open, false to stop.
 *
 * THE RULE THAT KEEPS IT SAFE
 *   Parallel writers own **disjoint paths**. The fences are hardcoded below, every lane prompt
 *   repeats its own, and after the Build phase the script compares what each lane says it changed
 *   (plus the git diff) against the fences. A lane that edits outside its fence is a P0.
 *
 * MEMORY
 *   The working memory (scripts/memory.ts) keeps the thread between sessions. Preflight runs one read-only recall
 *   (logged and returned, never fed to a later prompt, so resumed runs keep their cache). Each stop
 *   records where it stopped and what it waits for, and Ship records the outcome.
 *
 * THE LIMITS
 *   It never merges. It commits once and opens one PR.
 *
 * args (all optional):
 *   { root?: string,         absolute path of the checkout to work in (default: the git root where
 *                            the run was launched). Must be a git work tree.
 *     brief?: string,        a line about the product, to prefill the interview
 *     sector?: string,       closest taste sector, if you already know it
 *     redo?: boolean,        replace an existing DESIGN.md; the old brand becomes the anti-reference
 *     rebuildHome?: boolean, leave unset and the needs-pick stop asks for it
 *     answers?: object,      { <question id>: "<answer>" } from a needs-input stop
 *     pick?: number|"none",  the chosen comp id for round 1, or "none" to draw three more
 *     pick2?: number|"none", the same for round 2 (the fresh three)
 *     why?: object,          { <comp id>: "<why the user passed on it>" }, optional, goes in the PR
 *     accept?: object }      { <tag>: true|false } from a needs-accept stop
 */
// ---- generated from .claude/workflow-src/lib.js by scripts/workflows.ts; edit the source, then run `bun scripts/workflows.ts build` ----
/**
 * The helpers every workflow shares; scripts/workflows.ts pastes this file into each workflow.
 * Rules for an author:
 *   - no import, and no free variable except a JS built-in: whatever needs the runtime comes in
 *     through `workflowLib({ agent, log, name })`;
 *   - every top-level name here lands in each workflow's scope, so a workflow must not declare it again.
 */

// ---- Schemas ------------------------------------------------------------------------------------
const STR = { type: "string" };
const NUM = { type: "number" };
const BOOL = { type: "boolean" };
const STRS = { type: "array", items: STR };
const arr = (items) => ({ type: "array", items });
/** A closed object: every property required unless `required` lists some, no extra keys. */
const obj = (properties, required) => ({ type: "object", required: required || Object.keys(properties), properties, additionalProperties: false });
/** An open object: extra keys allowed, and `required` is left out unless given. */
const shape = (properties, required) => (required ? { type: "object", properties, required } : { type: "object", properties });

/** A branch name or slug: lower-case words joined by single hyphens. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The ticket-auditor's fixed checklist: one item per id, in this order. */
const CHECKLIST_IDS = ["problem", "user", "fit", "duplicate", "acceptance", "non_goals", "metric", "ui_states", "data", "roles", "i18n_analytics", "errors", "non_negotiables"];

// ---- Findings -----------------------------------------------------------------------------------
/** True for a finding that blocks: P0 or P1. */
const isP0P1 = (f) => f.severity === "P0" || f.severity === "P1";

// ---- Prompt pieces ------------------------------------------------------------------------------
/** Makes a `fence(label, text)` that wraps untrusted text in DATA markers; `note` goes after the label on the opening marker. */
const makeFence = (note = "") => (label, text) => `----- DATA: ${label}${note} -----\n${text}\n----- END DATA: ${label} -----`;
/** The preflight step that names the checkout: the caller's `args.root`, else the launch directory's git root. */
const rootClause = (root) =>
  typeof root === "string"
    ? `The caller gave root ${JSON.stringify(root)}. Run \`git -C <that> rev-parse --is-inside-work-tree\`; it must print true, else fail with "args.root is not a git work tree". ROOT is \`git -C <that> rev-parse --show-toplevel\`.`
    : "Run `git rev-parse --show-toplevel` in your starting directory. That is ROOT. Do not look for another checkout or a .claude/worktrees/* tree.";

// ---- Args and stops -------------------------------------------------------------------------------
/**
 * A string is a ticket ref (12, #12, an issue URL) or else free text under `textKey`; an object is
 * the args as given; anything else (an array, null, a number) is null.
 */
function parseArgs(args, textKey) {
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
function haltOrThrow(e) {
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
function memoryRecordCommand(slug, fields) {
  const oneLine = (v) => String(v).replace(/\s*[\r\n]+\s*/g, " ").split("MEMORY_EOF").join("MEMORY-EOF");
  const lines = Object.entries(fields).flatMap(([key, value]) =>
    [value].flat().filter((v) => v !== undefined && v !== null && v !== "").map((v) => `${key}: ${oneLine(v)}`)
  );
  return `bun scripts/memory.ts record ${slug} <<'MEMORY_EOF'\n${lines.join("\n")}\nMEMORY_EOF`;
}

// ---- Run telemetry ----------------------------------------------------------------------------------
/** FNV-1a, 32 bit, over the UTF-16 code units of `text`, as 8 lower-case hex digits. scripts/run-telemetry.ts computes the same sum. */
function ledgerChecksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A short verdict for the ledger: the result's `verdict` string, else pass or fail from its first boolean among ok, pass, passed, else "". */
function verdictOf(result) {
  if (!result || typeof result !== "object") return "";
  if (typeof result.verdict === "string") return result.verdict;
  for (const k of ["ok", "pass", "passed"]) if (typeof result[k] === "boolean") return result[k] ? "pass" : "fail";
  return "";
}

/** The most characters one ledger string keeps; agent output can reach a ledger string, so each is cut and stripped to a safe set. */
const LEDGER_FIELD_MAX = 80;

/**
 * The shell command that hands the ledger to scripts/run-telemetry.ts: one JSON array per call, then a
 * line with the call count and a checksum, so a runner that garbled the copy leaves nothing behind.
 * A script has no clock and no file access, so this is how a run reports its calls.
 */
function runRecordCommand(workflow, slug, calls) {
  const clean = (v) => String(v).replace(/[^A-Za-z0-9 :._/#()-]/g, "-").slice(0, LEDGER_FIELD_MAX).split("RUN_EOF").join("RUN-EOF");
  const lines = calls.map((c) => JSON.stringify([clean(c.label), clean(c.phase), clean(c.agent), clean(c.model), c.attempt, clean(c.outcome), clean(c.verdict)]));
  const footer = JSON.stringify({ calls: lines.length, check: ledgerChecksum(lines.join("\n")) });
  return `bun scripts/run-telemetry.ts record ${slug} ${workflow} <<'RUN_EOF'\n${[...lines, footer].join("\n")}\nRUN_EOF`;
}

/** The sentence a stop that returns a `review` page adds to its `next`: the page shows the run's numbers too. */
const runSummaryNote = (slug, workflow) =>
  `The page also shows the run summary: the output of \`bun scripts/run-telemetry.ts summary ${slug}\`, run from ROOT. Tokens and seconds read n/a until \`bun scripts/run-telemetry.ts ingest ${slug} ${workflow} <this run's transcript directory>\` has run; run it first when you have the directory.`;

// ---- Project config -----------------------------------------------------------------------------------
/** JSON with object keys sorted at every depth and no whitespace. scripts/lib/harness-config.ts computes the same text. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  const text = JSON.stringify(value);
  return text === undefined ? "null" : text;
}

/** The sentence a run stops with when the config line a runner copied does not check out. */
const CONFIG_COPY_FAULT = "the config copy did not verify; run the workflow again";

/**
 * Parses the one line `bun scripts/harness-config.ts show` prints ({ config, check }) and verifies it: the
 * checksum is recomputed over the stable JSON of `config`, so a runner that garbled the copy is caught.
 * `need` lists dotted keys the workflow cannot run without. Returns { config } or { error }.
 */
function readConfig(configJson, need) {
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
const andList = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
/** A string as a regular expression's source, matched literally. */
const reEscape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// ---- Helpers that need the runtime ----------------------------------------------------------------
function workflowLib({ agent, log, name }) {
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

  /** Run an agent thunk; one retry if it returns nothing or throws. Returns null after two failures. */
  async function twice(fn, what) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // `fn` makes its agent call before its first await. The attempt number is set for that call
        // only and put back before anything else runs, so a parallel branch never reads this retry.
        const before = attemptNo;
        attemptNo = Math.max(before, attempt);
        let pending;
        try {
          pending = fn(attempt);
        } finally {
          attemptNo = before;
        }
        const r = await pending;
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

  return { twice, checkArgs, asker, preflightFault, tracked, ledger, recordRun };
}
// ---- end of .claude/workflow-src/lib.js ----
const { twice, checkArgs, asker, preflightFault, tracked } = workflowLib({ agent, log, name: "brand-init" });

const input = args && typeof args === "object" ? args : {};
const badArg = checkArgs("brand-init", [["brief", "string"], ["sector", "string"], ["root", "string"], ["redo", "boolean"], ["rebuildHome", "boolean"], ["answers", "object"], ["why", "object"], ["accept", "object"]], input, true);
if (badArg) return badArg;
for (const k of ["pick", "pick2"]) {
  if (input[k] !== undefined && typeof input[k] !== "number" && input[k] !== "none") {
    log(`brand-init: args.${k} must be a comp id (number) or "none", got ${JSON.stringify(input[k])}. Nothing ran.`);
    return { error: `args.${k} must be a comp id or "none"` };
  }
}
const redo = input.redo === true;
const slug = "brand-init";
let ROOT = ""; // absolute repo root, resolved by Preflight; every later agent is fenced to it
let outDir = ""; // <ROOT>/.verify/brand-init, set after Preflight

const SKILL_RULE = "Load skills by plain name (`impeccable`, `design-taste-frontend`, `animate`, `emil-design-eng`); only on \"Unknown skill\" use `impeccable:impeccable` or `taste-skill:design-taste-frontend`. Load each once.";
const repoRules = () => `Repo rules: the tokens in ${cfg.paths.tokens} beat every skill. Use semantic tokens only: no raw
hex and no arbitrary Tailwind values in app code. Do not run git commit
unless your task says so. Dev servers: \`CI=1 bun run dev --port <port>\` on the port you were given.
Skills: ${SKILL_RULE}${
  redo
    ? `
This is a redo: ${cfg.docs.design} at the repo root describes the OLD brand, the one this run replaces. It is
not binding. The chosen direction replaces all of it, shapes, density, voice and component conventions
included; never follow a ${cfg.docs.design} rule that disagrees with the direction.`
    : ""
}`;

const FINDINGS = arr(
  obj({ severity: { type: "string", enum: ["P0", "P1", "P2", "P3"] }, issue: STR, file: { ...STR, description: "Repo-relative file the fix belongs in, if known" } }, ["severity", "issue"])
);

// =============================================================================================
phase("Preflight");

const pre = await tracked(
  `Pre-flight for /brand-init. Run these numbered steps in order and stop at the first failure. Fix nothing
except where a step says to.

  0. Root. ${rootClause(input.root)} ROOT must be an absolute path. Then \`cd\` to ROOT: items 1 to 6 run there, and so does every later step of
     this run. Return ROOT in \`root\`.
  1. Brand check. If DESIGN.md exists at ROOT and redo is ${redo}: when redo is false, fail with
     exactly: A brand exists. Run Workflow({ name: "brand-init", args: { redo: true } }) to replace it.
     (When redo is true, leave DESIGN.md in place; it is the brand to move away from.)
  2. Plugins. This run needs two plugin installs that a fresh fork may lack. Run
     \`find ~/.claude/plugins -path '*impeccable*' -name impeccable-documenter.md | head -1\` (the agent
     that writes DESIGN.md at Close) and \`find ~/.claude/plugins -path '*taste-skill*' -name draw.mjs | head -1\`
     (the comp renderer). If either prints nothing, fail with exactly: Missing plugin. Run
     claude plugin install impeccable@impeccable and claude plugin install taste-skill@taste-skill, then restart.
  3. Clean tree. \`git status --short\`. Ignore anything under .verify/. If
     anything else is dirty, fail and name the files: parallel lanes writing over uncommitted work make
     the diff unreadable.
  4. Baseline. \`./scripts/verify.sh --baseline\`. If red, fail and name the failing gate.
  5. Branch. If on main, \`git switch -c feat/brand-init\`. Otherwise stay.
  6. Config. Run \`bun scripts/harness-config.ts show\` from ROOT and return its one line of output exactly as \`config_json\`: copy it character for character, change nothing.
Return ok=false with a one-line reason for the first failure, else ok=true. Always return root when you found it.`,
  {
    label: "preflight",
    phase: "Preflight",
    agentType: "runner",
    effort: "low",
    schema: obj({ ok: BOOL, reason: STR, branch: STR, root: STR, config_json: STR }),
  }
);
const fault = preflightFault(pre, input.root);
if (fault) return { error: fault };
const conf = readConfig(pre.config_json, [
  "paths.appRoot", "paths.tokens", "paths.rootLayout", "paths.components", "paths.primitives", "paths.routes", "paths.home", "paths.locales",
  "brandInit.contractFence", "brandInit.primitiveLanes", "brandInit.sharedLanes", "brandInit.homeLane",
]);
if (conf.error) {
  log(`Pre-flight: ${conf.error}. Nothing ran.`);
  return { error: conf.error };
}
const cfg = conf.config;
const REPO_RULES = repoRules();
ROOT = pre.root.replace(/\/+$/, "");
outDir = `${ROOT}/.verify/brand-init`;

// Every agent after Preflight gets this preamble first (see asker in the library).
const ROOT_PREAMBLE = `ROOT = ${ROOT}
Work only inside ${ROOT}. cd there first. Every path in this task is relative to ${ROOT}. Never read or write another checkout.
That covers the comp and screenshot dirs (${ROOT}/.verify/...), ${cfg.docs.product}, ${cfg.docs.design}, git commands and dev servers.`;
const { ask, remember, recall } = asker(ROOT_PREAMBLE);
log(`Pre-flight green on ${pre.branch}, root ${ROOT}`);

// ---- Working memory (scripts/memory.ts, run by the runner) -------------------------------------
// recall is read-only. Its brief is logged and returned in the final result, and goes into NO later
// prompt: a re-run (resumeFromRunId) replays agents from cache only when their prompt is unchanged,
// and recall output can differ between runs. The record calls below follow asker's rule (library):
// a script merges each record and stamps the date, and a record holds only values the run already has.
const recalled = await recall(slug, "memory:recall", "Preflight");
log(`Memory recall: ${recalled ? String(recalled).slice(0, 300).replace(/\s+/g, " ") : "returned nothing"}`);

// =============================================================================================
phase("Brief");

// Step 1 reads the repo and drafts every answer. It writes nothing, and its prompt does not change
// between a first run and a re-run, so a resumed run gets it from cache.
const interview = await ask(
  `Prepare the impeccable \`init\` interview. Do NOT write any file and do NOT ask the user anything: you
cannot reach them. Draft the answers instead.

${SKILL_RULE}
Load \`impeccable\` and read its \`init\` instructions to get the questions it asks about the
product, the users and the tone. ${redo ? `This is a redo: also include a question on what the old brand (${cfg.docs.design}) got wrong.` : ""}
Draft an answer to each one from:
  · args.brief: ${JSON.stringify(input.brief ?? null)}
  · args.sector: ${JSON.stringify(input.sector ?? null)}
  · the repo (${ROOT}): README.md, AGENTS.md, package.json, ${cfg.paths.home}, the i18n locale files.

${
  `${cfg.docs.product} exists at ${ROOT}/${cfg.docs.product}? Check. If it does and redo is ${redo}: when redo is false, use its content as the drafts and mark them confident; when redo is true, prefill from it.`
}
One exception: a ${cfg.docs.product} that says it describes the starter itself is the starter's file, not this
product's. A fork that still has it has not said what it is building. Do not draft from it or from the
repo's own description of the starter; draft from args.brief, and mark every answer that args.brief does
not state confident=false.

Return every question with a short stable id, the question text, your draft answer, and confident:
true only when the repo or args.brief states the answer outright. Mark a guess confident=false: the user
will be asked about those.`,
  {
    label: "brief:interview",
    phase: "Brief",
    // general-purpose: loads `impeccable` (Skill) and reads the repo; no project agent has that job.
    agentType: "general-purpose",
    schema: obj({ questions: arr(obj({ id: STR, question: STR, draft: STR, confident: BOOL })) }),
  }
);
if (!interview || !interview.questions.length) {
  log(`Brief agent returned no questions — no ${cfg.docs.product} to design from.`);
  return { error: "brief agent returned nothing" };
}
const resumed = input.answers && typeof input.answers === "object";
const given = resumed ? input.answers : {};
// A resume with args.answers settles the brief: an id left out keeps its draft.
const unanswered = resumed ? [] : interview.questions.filter((q) => !q.confident);
if (unanswered.length) {
  log(`Brief: ${unanswered.length} question(s) need the user. Stopping; re-run with args.answers.`);
  const memInput = await remember(
    slug,
    {
      status: "in-progress",
      log: `Brief phase stopped for input; ${cfg.docs.product} is not written yet. redo=${redo}; args.brief=${JSON.stringify(input.brief ?? null)}; args.sector=${JSON.stringify(input.sector ?? null)}; checkout ${ROOT}.`,
      stopped: "Brief phase, status needs-input",
      waiting: `the user's answers to ${unanswered.length} interview question(s), ids ${unanswered.map((q) => q.id).join(", ")}`,
      next: "re-run Workflow brand-init with resumeFromRunId set to this run and args.answers = { <id>: \"<answer>\" }",
      todo: "answer the open interview questions",
    },
    "memory:record:needs-input",
    "Brief"
  );
  return {
    memory: memInput,
    status: "needs-input",
    questions: unanswered.map((q) => ({ id: q.id, question: q.question, draft: q.draft })),
    next: "Ask the user these in chat (show each draft, ask them to confirm or correct). Then re-run with resumeFromRunId set to this run and args.answers = { <id>: \"<answer>\" }. Ids left out keep their draft.",
  };
}
const finalAnswers = interview.questions.map((q) => ({ id: q.id, question: q.question, answer: typeof given[q.id] === "string" ? given[q.id] : q.draft }));

const brief = await ask(
  `Write ${ROOT}/${cfg.docs.product} from these interview answers, in the format impeccable \`init\` writes. The user
has settled them; do not change an answer. Write nothing else.

${JSON.stringify(finalAnswers, null, 1)}

Return a one-line "oneLine" describing the product for a taste brief, and the closest "sector" (run
\`find ~/.claude/plugins -path '*taste-skill*' -name draw.mjs | head -1\` for the script, then
\`node <script> --list sectors\`; use args.sector when it was given and valid).`,
  {
    label: "brief:write",
    phase: "Brief",
    agentType: "docs-writer", // it writes one document from settled answers, as plan-feature's product:write does
    schema: obj({ oneLine: STR, sector: STR }),
  }
);
if (!brief) {
  log(`Brief writer returned nothing — no ${cfg.docs.product} to design from.`);
  return { error: "brief agent returned nothing" };
}

// =============================================================================================
// Draw / critique / pick, up to two rounds. A second "None of these" ends the run.

const antiText = redo
  ? `\nANTI-REFERENCE: the current brand is described in ${cfg.docs.design}. Read it. Your comp must move AWAY from it
in palette, type, shape and voice. A comp that echoes it fails.\n`
  : "";

const DRAW_SCHEMA = {
  ...obj({ html: { ...STR, description: "Absolute path of comp.html" }, tokens: { type: "object", description: "The exact contents of tokens.json" }, screenshots: STRS }),
  additionalProperties: true,
};

const drawPrompt = (d, extra) => `Draw brand comp ${d.id} for this product. You are one of up to three parallel lanes, each drawing a
different direction.

Read ${ROOT}/${cfg.docs.product} (the product) and your direction sheet ${d.sheet}. The sheet is your art direction:
follow it, do not blend in the other lanes' directions.
${antiText}${extra ?? ""}
FILE FENCE — write only under ${outDir}/${d.dirName ?? d.id}/ and nowhere else. If you think you need a file outside
it, STOP and report instead of editing it.

Skills: load \`design-taste-frontend\` and lead the landing hero with it; load
\`impeccable\` and lead the dashboard and the primitives strip with it; load \`animate\` and
\`emil-design-eng\` to build the motion.

Write:
  · comp.html — ONE self-contained file (inline CSS and JS; fonts by Google Fonts link only) holding
    the landing hero, a dashboard screen, and a primitives strip (button, input, badge, table row,
    dialog, toast), with real motion and a light/dark toggle.
  · tokens.json — the TOKENS shape, exactly: { name, light, dark, fonts, radius, density, motion,
    voice, wordmark }. light and dark each hold the same keys as the custom properties in
    ${cfg.paths.tokens} (:root and .dark): read that file and match the key list, every colour an oklch()
    string. fonts is { sans: {family, href}, display: {family, href}|null, mono: {family, href}|null };
    density is compact|regular|airy; motion has ease-out, ease-in-out, duration-fast, duration-base,
    duration-slow; voice is 3 lines; wordmark is { text, family, weight, tracking, case: lower|upper|title }.
  · shots/desktop-light.png, desktop-dark.png, mobile-light.png, mobile-dark.png — real screenshots
    of comp.html (Playwright CLI, headless), plus shots/desktop-1920-light.png: at 1920 the content
    must sit in a max-width page container, not run edge to edge.
Do not write a critique file; the critics return theirs as JSON.

${REPO_RULES}
Return the ABSOLUTE comp.html path, the tokens object you wrote, and the ABSOLUTE screenshot paths.`;

async function critique(comp) {
  const dir = comp.dir;
  const pass = comp.redrawn ? ":redraw" : "";
  // The taste loop edits comp.html (look, fix, look), so it runs alone first. The two critics
  // after it only read the finished pixels, so they run together.
  const taste = await ask(
    `Run the taste look-and-fix loop on the LANDING HERO of ${comp.html}.

${SKILL_RULE}
Load \`design-taste-frontend\` and follow its references/critique.md loop: screenshot at
desktop (1440 and 1920) and mobile, score, fix, repeat — AT MOST 3 rounds. You may edit only ${dir}/comp.html,
${dir}/tokens.json and ${dir}/shots/. When a fix changes a colour, font, radius, density, motion value, voice line
or the wordmark in comp.html, make the same change in tokens.json (same shape, oklch() colours), so the file always
matches what the comp shows. Retake the four screenshots (desktop/mobile x light/dark) after your last edit.
At 1920 the content must sit in a max-width page container; edge to edge is a defect to fix. A score under 7.5 after round 3 is reported exactly as scored. Never round up.
Return the final score (a number), short notes on what changed and what still bites, and \`tokens\`: the exact
contents of ${dir}/tokens.json after your last edit (read the file back).`,
    {
      label: `critique:${comp.id}:taste${pass}`,
      phase: "Critique",
      agentType: "ui-builder",
      schema: obj({ score: NUM, notes: STR, tokens: { type: "object" } }),
    }
  );

  const [imp, motion] = await parallel([
    () =>
      ask(
        `Critique the DASHBOARD screen and the PRIMITIVES STRIP of ${comp.html}. Read-only: do not edit.

${SKILL_RULE}
Load \`impeccable\` and run its \`critique\` on the screenshots in ${dir}/shots/ (judge pixels,
not source). Report each issue with a P0-P3 severity.

Also check WCAG AA contrast for body text, muted text, primary-on-primary-foreground and borders
against ${dir}/tokens.json, in the light theme and the dark theme separately. Report contrastAA.light
and contrastAA.dark as booleans (true only if every pair passes AA).`,
        {
          label: `critique:${comp.id}:impeccable${pass}`,
          phase: "Critique",
          // general-purpose: read-only critique that loads `impeccable` (Skill) and computes contrast; proto-critic
          // retakes its own shots and returns a fixed shape.
          agentType: "general-purpose",
          schema: obj({ findings: FINDINGS, contrastAA: obj({ light: BOOL, dark: BOOL }) }),
        }
      ),
    () =>
      ask(
        `Review the motion in ${comp.html}. Read-only: do not edit.

${SKILL_RULE}
Load the \`emil-design-eng\` skill and judge the motion by its rules (\`review-animations\` is
user-only: the Skill tool refuses it). Check easing, duration, purpose, and that
prefers-reduced-motion collapses the motion. Return verdict PASS or FAIL with notes.`,
        {
          label: `critique:${comp.id}:motion${pass}`,
          phase: "Critique",
          // general-purpose: read-only motion review that loads `emil-design-eng` (Skill); no project agent reviews motion.
          agentType: "general-purpose",
          schema: obj({ verdict: { type: "string", enum: ["PASS", "FAIL"] }, notes: STR }),
        }
      ),
  ]);

  const result = {
    taste: taste ?? { score: 0, notes: "taste critic returned nothing" },
    impeccable: { findings: imp ? imp.findings : [{ severity: "P1", issue: "impeccable critic returned nothing" }] },
    motion: motion ?? { verdict: "FAIL", notes: "motion critic returned nothing" },
    contrastAA: imp ? imp.contrastAA : { light: false, dark: false },
  };

  // The loop may have changed the comp and its tokens.json; carry the file's current contents forward.
  result.tokens = taste && taste.tokens && typeof taste.tokens === "object" ? taste.tokens : comp.tokens;
  return result;
}

async function drawAndCritique(d, extra, redrawn) {
  const drawn = await twice(
    (n) =>
      ask(drawPrompt(d, n > 1 ? `\nYour first attempt failed. First clear everything inside ${outDir}/${d.dirName ?? d.id}/ (your own directory only), then keep it smaller and finish.\n${extra ?? ""}` : extra), {
        label: `draw:${d.id}${redrawn ? ":redraw" : ""}`,
        phase: "Draw",
        agentType: "ui-builder",
        schema: DRAW_SCHEMA,
      }),
    `comp ${d.id}`
  );
  if (!drawn) return { id: d.id, failed: "comp lane failed twice" };
  const comp = {
    id: d.id,
    dir: `${outDir}/${d.dirName ?? d.id}`,
    html: `${outDir}/${d.dirName ?? d.id}/comp.html`,
    tokens: drawn.tokens,
    screenshots: drawn.screenshots ?? [],
    redrawn: !!redrawn,
  };
  const c = await critique(comp);
  return {
    ...comp,
    tokens: c.tokens,
    critique: { taste: c.taste, impeccable: c.impeccable, motion: c.motion },
    contrastAA: c.contrastAA,
  };
}

// One round: deal the direction sheets, draw and critique in parallel, check sameness, redraw once.
async function proposeRound(firstId, avoidDrawIds, sector, oneLine) {
  phase("Draw");
  const deal = await ask(
    `Deal three design directions with taste's draw.mjs.

Find the script: \`find ~/.claude/plugins -path '*taste-skill*' -name draw.mjs | head -1\` (call it $DRAW).
Sector: ${sector}. Brief: ${JSON.stringify(oneLine)}.

  1. \`node $DRAW --sector ${sector} --brief ${JSON.stringify(oneLine)} --options 3${avoidDrawIds.length ? ` --avoid ${avoidDrawIds.join(",")}` : ""} --out ${outDir}/directions/.taste\`
     This prints three direction ids and writes nothing else. A brand is not fixed yet, so do NOT
     pass \`--keep palette,type\`; the comps choose both.
  2. \`mkdir -p ${outDir}/directions\`, then for each printed id, in order, write its full sheet to a file:
     \`node $DRAW --sector ${sector} --brief ${JSON.stringify(oneLine)} --direction <id> --out ${outDir}/directions/.taste > ${outDir}/directions/<n>.md\`
     with <n> = ${firstId}, ${firstId + 1}, ${firstId + 2} in order.
Write only under ${outDir}/directions/. Return the printed draw ids and the three sheet paths.`,
    {
      label: `draw:directions:${firstId}`,
      phase: "Draw",
      agentType: "runner",
      schema: obj({ drawIds: STRS, directions: arr(obj({ id: NUM, sheet: STR })) }),
    }
  );
  const directions = deal ? deal.directions.slice(0, 3) : [];
  if (!directions.length) return { error: "draw.mjs produced no directions" };
  log(`Propose: ${directions.length} comp lane(s) in parallel${redo ? `, moving away from ${cfg.docs.design}` : ""}`);

  const outcomes = await pipeline(directions, (d) => drawAndCritique(d, "", false));
  let comps = outcomes.filter((o) => o && !o.failed);
  const failed = directions
    .map((d, i) => ({ id: d.id, o: outcomes[i] }))
    .filter((x) => !x.o || x.o.failed)
    .map((x) => ({ id: x.id, reason: (x.o && x.o.failed) || "lane threw" }));
  failed.forEach((f) => log(`Lane ${f.id} failed: ${f.reason}`));

  // Sameness: a barrier, because it compares every comp with every other.
  phase("Critique");
  let similar = [];
  if (comps.length >= 2) {
    const sameness = await ask(
      `Do any of these brand comps look alike? Judge from the screenshots (open them) and the tokens: palette
hue family, type pairing, shape language, density, mood. Read-only.

${comps.map((c) => `--- comp ${c.id} ---\nscreenshots: ${c.screenshots.join(", ")}\ntokens: ${JSON.stringify({ name: c.tokens && c.tokens.name, fonts: c.tokens && c.tokens.fonts, radius: c.tokens && c.tokens.radius, density: c.tokens && c.tokens.density, primary: c.tokens && c.tokens.light && c.tokens.light.primary })}`).join("\n")}

Return the pairs of comp ids a stranger would call the same brand. Empty list if none.`,
      {
        label: "critique:sameness",
        phase: "Critique",
        // general-purpose: a read-only judgment over screenshots; runner does not judge and plan-judge grades checklists.
        agentType: "general-purpose",
        schema: obj({ pairs: arr(arr(NUM)) }),
      }
    );
    similar = ((sameness && sameness.pairs) || []).filter((p) => Array.isArray(p) && p.length === 2);
  }

  // Redraw ONE comp, ONCE: the second of the first flagged pair. Keep the original if it fails.
  if (similar.length) {
    const [keepId, redrawId] = similar[0];
    const keep = comps.find((c) => c.id === keepId);
    const dir = directions.find((d) => d.id === redrawId);
    if (keep && dir && comps.some((c) => c.id === redrawId)) {
      log(`Comps ${keepId} and ${redrawId} look alike — redrawing ${redrawId} once`);
      // Redraw into <id>-r so a failed redraw cannot corrupt the original comp's files.
      const again = await drawAndCritique(
        { ...dir, dirName: `${dir.id}-r` },
        `\nREDRAW: your first comp for this direction looked like comp ${keepId} (${keep.tokens && keep.tokens.name}, primary ${keep.tokens && keep.tokens.light && keep.tokens.light.primary}). Push further from it: a different hue family, type pairing and shape language. Same direction sheet.\n`,
        true
      );
      if (again && !again.failed) comps = comps.map((c) => (c.id === redrawId ? again : c));
      else log(`Redraw of ${redrawId} failed — keeping the original, still flagged as similar`);
    }
  }

  const low = comps.filter((c) => c.critique.taste.score < 7.5).map((c) => `${c.id} (${c.critique.taste.score})`);
  if (low.length) log(`Taste score under 7.5, reported as scored: ${low.join(", ")}`);
  return { comps, failed, similar, drawIds: deal.drawIds };
}

let sector = brief.sector;
let rejectedAll = [];
let winner = null;
let rebuildHome = false;
let avoid = [];
let failedAll = [];
let lastRound = null;

for (let round = 1; round <= 2; round++) {
  const r = await proposeRound(round === 1 ? 1 : 4, avoid, sector, brief.oneLine);
  if (r.error) {
    log(`Propose round ${round}: ${r.error}`);
    return { error: r.error };
  }
  lastRound = r;
  failedAll = [...failedAll, ...r.failed];
  if (!r.comps.length) {
    log("Every comp lane failed twice — nothing to pick from.");
    return { error: "every comp lane failed", failed: r.failed };
  }
  // The user picks on a review page. Stop and return the comps; the re-run brings args.pick (round 1) or args.pick2.
  const pickKey = round === 1 ? "pick" : "pick2";
  const pickArg = input[pickKey];
  const known = pickArg === "none" || (typeof pickArg === "number" && r.comps.some((c) => c.id === pickArg));
  const needs = [];
  if (!known) needs.push(pickKey);
  if (pickArg !== "none" && typeof input.rebuildHome !== "boolean") needs.push("rebuildHome");
  if (needs.length) {
    phase("Pick");
    log(`Pick: round ${round}, ${r.comps.length} comp(s) ready. Stopping; re-run with ${needs.map((n) => "args." + n).join(" and ")}.`);
    const memPick = await remember(
      slug,
      {
        status: "in-progress",
        log: `Pick phase, round ${round}: ${cfg.docs.product} is written; ${r.comps.length} comp(s) drawn and critiqued. Comps (id, name, html, taste score): ${r.comps.map((c) => `${c.id}, ${(c.tokens && c.tokens.name) || "unnamed"}, ${c.html}, taste ${c.critique.taste.score}`).join("; ")}. Comps that failed to draw: ${r.failed.length ? r.failed.map((f) => f.id).join(", ") : "none"}. Flagged as look-alikes: ${r.similar.length ? JSON.stringify(r.similar) : "none"}. Comp files live under ${outDir}/ (local, not committed). Checkout ${ROOT}.`,
        stopped: `Pick phase, round ${round}, status needs-pick`,
        waiting: `the user's choice (${needs.join(" and ")}): a comp id or "none", ${needs.includes("rebuildHome") ? "and whether to rebuild the home page" : "rebuildHome already answered"}`,
        next: `re-run Workflow brand-init with resumeFromRunId set to this run and args.${needs.includes("rebuildHome") && needs.length === 1 ? "rebuildHome" : needs.join(" and args.")}`,
      },
      "memory:record:needs-pick",
      "Pick"
    );
    return {
      memory: memPick,
      status: "needs-pick",
      round,
      needs,
      comps: r.comps.map((c) => ({
        id: c.id,
        name: c.tokens && c.tokens.name,
        html: c.html,
        screenshot: c.screenshots.find((s) => /desktop-light/.test(s)) || c.screenshots[0] || null,
        screenshots: c.screenshots,
        tasteScore: c.critique.taste.score,
        pitch: [c.tokens && c.tokens.name, c.tokens && c.tokens.voice && c.tokens.voice[0]].filter(Boolean).join(" — "),
        motion: c.critique.motion.verdict,
        contrastAA: c.contrastAA,
        openFindings: c.critique.impeccable.findings.filter(isP0P1).length,
        redrawn: c.redrawn,
      })),
      failed: r.failed,
      similar: r.similar,
      question: `Which comp should be the brand? Look at each comp and its screenshots. Pick a comp id, or "none" to draw three more.${typeof input.rebuildHome === "boolean" ? "" : ` Also: rebuild the home page too (one more lane; ${cfg.paths.home} changes)? Yes is recommended.`}`,
      review: `${outDir}/pick-${round}.html`,
      next: `Write the review page at ${outDir}/pick-${round}.html (run \`npx -y lavish-axi playbook comparison\` and \`playbook input\` first; style it with the app's tokens from ${cfg.paths.tokens}). One card per comp: the comp itself in an iframe (src = its comp.html path relative to the page, e.g. "a/comp.html", never a leading /), its desktop and mobile shots (relative paths), name, pitch, taste score, motion verdict, contrast and open P0/P1 count; mark look-alikes from \`similar\`. ${runSummaryNote(slug, "brand-init")} Below the cards ONE form: a radio per comp id plus "None of these — draw three more"${typeof input.rebuildHome === "boolean" ? "" : ", a yes/no for rebuilding the home page (yes preselected)"}, an optional "why not" note per comp, and one submit that calls window.lavish.queuePrompt once with data { ${pickKey}, ${typeof input.rebuildHome === "boolean" ? "" : "rebuildHome, "}why }. Open it with \`npx -y lavish-axi <page>\`, tell the user it is open, then run \`npx -y lavish-axi poll <page>\` in the foreground and re-run it if it times out. Read the answer, post \`npx -y lavish-axi reply <page> --agent-reply "<what happens next>"\`, then re-run with resumeFromRunId set to this run and args.${pickKey} = <comp id as a number> or "none"${typeof input.rebuildHome === "boolean" ? "" : ", and args.rebuildHome = true|false"}. Keep every other arg. Optional: args.why = { <comp id>: "<why they passed>" }. If lavish will not start, ask in chat instead.`,
    };
  }
  const p = {
    decision: pickArg === "none" ? "none" : "pick",
    pick: pickArg === "none" ? null : pickArg,
    rebuildHome: input.rebuildHome === true,
    rejected: r.comps.map((c) => {
      const said = input.why && typeof input.why[c.id] === "string" ? input.why[c.id] : null;
      const top = c.critique.impeccable.findings.find(isP0P1);
      return { id: c.id, why: said || `not picked; taste ${c.critique.taste.score}${top ? `, open ${top.severity}: ${top.issue}` : ""}` };
    }),
  };
  const chosen = p.decision === "pick" ? r.comps.find((c) => c.id === p.pick) : null;
  if (chosen) {
    winner = chosen;
    rebuildHome = input.rebuildHome === true;
    rejectedAll = [...rejectedAll, ...p.rejected.filter((x) => x.id !== chosen.id)];
    break;
  }
  rejectedAll = [...rejectedAll, ...p.rejected];
  avoid = r.drawIds;
  if (round === 2) {
    log("The user rejected both sets. Not drawing a third time on my own.");
    return {
      error: "both sets of comps rejected — ask the user what they want to see, then start a fresh run",
      comps: r.comps,
      rejected: rejectedAll,
    };
  }
  log("None of these — one fresh draw excluding the first three");
}

// =============================================================================================
// Apply. Everything below builds the winner.
const tokens = winner.tokens;
const compDir = winner.dir;
const rejected = rejectedAll;

const ui = (names) => names.map((n) => `${cfg.paths.primitives}/${n}.tsx`);

// The fences come from harness.config.json (brandInit). The nine primitive lanes cover every file in the primitives folder once.
const CONTRACT_FENCE = [...cfg.brandInit.contractFence];
const laneOf = (l) => ({ name: l.name, motion: l.motion, owns: [...l.owns] });
const BUILD_LANES = [
  ...cfg.brandInit.primitiveLanes.map((l) => ({ name: l.name, motion: l.motion, owns: ui(l.files) })),
  ...cfg.brandInit.sharedLanes.map(laneOf),
  ...(rebuildHome ? [laneOf(cfg.brandInit.homeLane)] : []),
];
const ALL_FENCES = [...CONTRACT_FENCE, ...BUILD_LANES.flatMap((l) => l.owns)];

// Paths no lane owns but that may legitimately change while the run is live.
const IGNORED_PREFIXES = [".verify/", "plans/", ".react-router/", "node_modules/", ".wrangler/", "test-results/", "playwright-report/"];

// Paths the sequential fix:orphans lane may edit: app code that no lane owns. Never tests or config.
const orphanMayEdit = (path) =>
  path.startsWith(cfg.paths.appRoot) && !inFence(path, ALL_FENCES) && !/(^|\/)__tests__\/|\.(test|spec)\.[jt]sx?$|\.config\.[jt]s$/.test(path);
const orphanTouched = new Set(); // paths fix:orphans edited legitimately; the fence diff must not flag them
const inFence = (path, fence) =>
  fence.some((f) => (f.endsWith("/**") ? path.startsWith(f.slice(0, -2)) : path === f));
const ignored = (path) => IGNORED_PREFIXES.some((p) => path.startsWith(p));
// The contract lane owns the tokens file and the root layout, so contrast and font-link findings have an owner.
const CONTRACT_LANE = { name: "contract:tokens", owns: CONTRACT_FENCE };
const laneByName = (n) => (n === CONTRACT_LANE.name ? CONTRACT_LANE : BUILD_LANES.find((l) => l.name === n) || null);
const ownerOf = (path) => BUILD_LANES.find((l) => inFence(path, l.owns)) || (inFence(path, CONTRACT_FENCE) ? CONTRACT_LANE : null);

// Files the run itself writes outside every fence: the brief and the brand docs.
const allowed = (path) => path === cfg.docs.product || path === cfg.docs.design || path.startsWith(cfg.docs.design.replace(/\.md$/, "."));
// Paths that were already dirty before the contract lane ran; filled by the snapshot below.
const preDirty = new Set();
const exempt = (path) => ignored(path) || allowed(path) || preDirty.has(path) || orphanTouched.has(path);

const tokensJson = JSON.stringify(tokens, null, 1);
const DESIGN_BRIEF = `BRAND: the winner is comp ${winner.id} ("${tokens.name ?? "unnamed"}"), at ${compDir} — comp.html shows it
drawn, tokens.json holds the values. Product context is in ${ROOT}/${cfg.docs.product}.
TOKENS:
${tokensJson}
The comps that lost, so you do not drift toward them:
${rejected.length ? rejected.map((r) => `  · comp ${r.id}: ${r.why}`).join("\n") : "  (none recorded)"}`;

const FILES_SCHEMA = obj(
  {
    files: { ...STRS, description: "Every repo-relative file you changed" },
    reverted: { ...STRS, description: "Out-of-fence paths you restored (fence repair only)" },
    report: { ...STR, description: "One line per file, plus anything you could not do" },
    cwd: { ...STR, description: "Output of `git rev-parse --show-toplevel` run in the directory you worked in" },
    changedDefaults: { ...STRS, description: "Every default prop value or behaviour you changed, as 'file: prop/behaviour, old -> new, why'. Empty if none." },
    needs: { type: "array", description: "Files you needed but do not own (you did not edit them)", items: obj({ file: STR, why: STR }) },
  },
  ["files", "report", "cwd"]
);

const VERDICT_SCHEMA = obj({
  verdict: { type: "string", enum: ["PASS", "FAIL"] },
  findings: FINDINGS,
  evidence: { ...STR, description: "Screenshot paths or verbatim command output tails" },
});

// ---------------------------------------------------------------------------------------------
phase("Contract");

// Snapshot what is dirty before any lane writes, so every later diff can subtract it. PRODUCT.md
// (written by Brief, untracked) lands here, and nothing may revert or delete it.
const snap = await ask(
  `Run these steps. Read-only; change nothing.
  1. \`git status --porcelain\`
  2. Return \`paths\`: every path in that output, repo-relative, untracked files included (for a rename, the new path).`,
  {
    label: "contract:snapshot",
    phase: "Contract",
    agentType: "runner",
    effort: "low",
    schema: obj({ paths: STRS }),
  }
);
(snap ? snap.paths : []).forEach((p) => preDirty.add(p));
if (!snap) log("WARNING: pre-build snapshot returned nothing — stray-file detection may over-report");

// The one sequential step: every build lane reads these tokens, so they land first.
const contract = await ask(
  `Apply the chosen brand's token layer. You are the CONTRACT lane; the build lanes start after you finish.

${DESIGN_BRIEF}

FILE FENCE — you own ${CONTRACT_FENCE.join(" and ")} and nothing else. If you think you need another
file, STOP and report it.

Do:
  1. ${cfg.paths.tokens} — set every custom property in :root and .dark from the tokens (same key list; read
     the file and match it, adding none and dropping none unless the tokens differ). Add the motion
     tokens as --ease-out, --ease-in-out, --duration-fast, --duration-base, --duration-slow, and a
     @media (prefers-reduced-motion: reduce) block that collapses the durations to 0ms. Set --radius,
     and the font families (--font-sans and, if present, display and mono).
  2. ${cfg.paths.rootLayout} — add the font <link> tags for tokens.fonts hrefs (preconnect plus stylesheet).
  3. AA check: for each foreground/background pair (foreground/background, card, popover, primary,
     secondary, muted, accent, sidebar variants, destructive) in light AND dark, compute WCAG contrast.
     A pair under 4.5:1 for text gets its lightness adjusted, keeping hue and chroma. List every
     change you made.
Load \`impeccable\` for the colour work. The tokens in ${cfg.paths.tokens} beat every skill.

${REPO_RULES}
Return the files you changed, your cwd (\`git rev-parse --show-toplevel\`), and a report that lists each contrast adjustment (token, before, after).`,
  { label: "contract:tokens", phase: "Contract", agentType: "ui-builder", schema: FILES_SCHEMA }
);

if (!contract) {
  // Lanes against missing tokens would each invent their own.
  log("Contract lane returned nothing — not fanning the build lanes out.");
  return {
    pick: winner.id,
    lanes: [],
    fenceViolations: [],
    blockingFindings: [{ severity: "P0", source: "contract", issue: "token contract lane returned nothing" }],
    verdicts: [],
    designMd: null,
    synthesis: "Contract lane failed; nothing was built. Re-run the workflow.",
  };
}
// ---------------------------------------------------------------------------------------------
phase("Build");

log(`Build: ${BUILD_LANES.length} lanes — ${BUILD_LANES.filter((l) => l.name !== "shell").length} in parallel, then shell`);

const PRIMITIVE_RULE = `PRIMITIVE RULE: edit the files in place through their cva variants and the semantic tokens. Keep every
export, prop and variant name, so no call site changes. No raw hex, no arbitrary Tailwind values.
Keep every DEFAULT prop value and every behaviour as well as every name (for example a Tooltip's
sideOffset, a dialog's width, an element's role or aria attributes, focus handling), unless the chosen comp
demands the change. List each default or behaviour change you do make in \`changedDefaults\`
('file: prop or behaviour, old -> new, why'). If you changed none, return an empty list.`;

const laneTask = (lane) =>
  lane.name.startsWith("primitives")
    ? PRIMITIVE_RULE
    : lane.name === "shell"
      ? `You own the app shells and the brand copy, and nothing else. Do: (1) the wordmark on EVERY shell: the admin sidebar header (app-sidebar.tsx still shows "Acme Inc."), the auth shell, and any other header or footer that carries the product name, using the wordmark component under ${cfg.paths.components}/brand/ (the shared lane has written it; read it, do not edit it); (2) the brand name, page titles (meta.title) and voice lines in BOTH ${cfg.paths.locales}/en and ${cfg.paths.locales}/zh, from tokens.voice and ${ROOT}/${cfg.docs.product}, keeping every key. Keep every export and prop. Do NOT touch page layouts (dashboard, admin pages, login and sign-up forms, home); if one needs a change, list it in \`needs\`.`
    : lane.name === "shared"
      ? `Also add a typeset wordmark under ${cfg.paths.components}/brand/ from tokens.wordmark (text, family, weight, tracking, case). Keep every export and prop of the existing components.`
      : "Rebuild the home page in the chosen brand, using tokens.voice for copy tone. Keep its i18n keys and routes working.";

const lanePrompt = (lane, extra) => `Lane: ${lane.name}. You are one of ${BUILD_LANES.length} lanes building the chosen brand in parallel.

${DESIGN_BRIEF}

The token layer is already in ${cfg.paths.tokens} (and the font link in ${cfg.paths.rootLayout}). Read them; do not edit them.

FILE FENCE — you own these paths and only these paths:
${lane.owns.map((p) => `  · ${p}`).join("\n")}
Editing anything outside them collides with a concurrent lane. If your task appears to need a file you
do not own, STOP and report it instead of editing it.

${laneTask(lane)}

No dev server and no browser in this lane: the Check phase drives the browser, and parallel dev servers
share one Vite cache and corrupt each other. Verify with \`bun run typecheck\` only. If you need a file
you do not own, do not edit it: return it in \`needs\`. Return your cwd (\`git rev-parse --show-toplevel\`).

Skills: load ${lane.name === "home" ? "`design-taste-frontend` as lead (public page)" : "`impeccable` as lead"}.${
  lane.motion
    ? " This lane owns something that moves: also load `animate` and `emil-design-eng`. Motion uses the --ease-* and --duration-* tokens."
    : " This lane owns nothing that moves: do NOT load `animate` or `emil-design-eng`."
}
${extra ?? ""}
${REPO_RULES}
Return the files you changed and a one-line-per-file report.`;

const buildLane = (lane) =>
  ask(lanePrompt(lane), { label: `build:${lane.name}`, phase: "Build", agentType: "ui-builder", schema: FILES_SCHEMA });
const parallelLanes = BUILD_LANES.filter((l) => l.name !== "shell");
const builtParallel = await parallel(parallelLanes.map((lane) => () => buildLane(lane)));
// The shell lane imports the wordmark `shared` writes, so it runs once the wave is done.
const builtShell = await buildLane(BUILD_LANES.find((l) => l.name === "shell"));
const builtByName = new Map([...parallelLanes.map((l, i) => [l.name, builtParallel[i]]), ["shell", builtShell]]);
// A lane that returns nothing gets one retry, alone. If it is still empty its work is missing, and
// that blocks Ship until the user accepts it (see `missingBuild` in openBlocking).
const missingBuild = [];
for (const lane of BUILD_LANES) {
  if (builtByName.get(lane.name)) continue;
  log(`WARNING: build:${lane.name} returned nothing; retrying once`);
  const retry = await buildLane(lane);
  if (retry) builtByName.set(lane.name, retry);
  else missingBuild.push({ severity: "P1", source: `build:${lane.name}`, issue: `build lane returned nothing twice; its fence (${lane.owns.join(", ")}) was not rebuilt` });
}
const built = BUILD_LANES.map((l) => builtByName.get(l.name) ?? null);

const lanes = BUILD_LANES.map((lane, i) => ({
  name: lane.name,
  owns: lane.owns,
  files: built[i] ? built[i].files : [],
  cwd: built[i] ? built[i].cwd : undefined,
  changedDefaults: built[i] ? built[i].changedDefaults ?? [] : [],
  needs: built[i] ? built[i].needs ?? [] : [],
  report: built[i] ? built[i].report : "lane returned nothing",
}));
if (built.some((b) => !b)) log(`WARNING: ${built.filter((b) => !b).length} build lane(s) returned nothing`);

// Fence check, two ways. (a) each lane's own list of changed files against its fence;
// (b) the git diff against the union of every fence, to catch edits no lane admitted to.
// Exempt: paths dirty before the contract lane ran (preDirty), the allow-listed files, and the
// ignored prefixes. `fenceViolations` is PERSISTENT: an entry leaves it only when a re-check proves
// it clean, so a later round can never wipe an earlier violation by overwriting the list.
//   · a path outside every fence is clean once the git diff no longer shows it;
//   · a path inside another lane's fence is clean once the OFFENDING lane's re-run reports it in
//     `reverted` (the diff cannot tell the owner's legitimate edits from the offender's).
let fenceViolations = [];
async function fenceCheck(reports, phaseName) {
  const diff = await ask(
    `Run these steps. Read-only; change nothing.
  1. \`git status --porcelain\`
  2. \`git diff --name-only HEAD\`
  3. Return \`paths\`: every repo-relative path from either output, untracked files included, each once.`,
    {
      label: "build:fence-diff",
      phase: phaseName,
      agentType: "runner",
      effort: "low",
      schema: obj({ paths: STRS }),
    }
  );
  if (!diff) log("WARNING: git diff fence check returned nothing — earlier violations stay, only lane self-reports are added");
  const current = new Set(diff ? diff.paths : []);
  const next = [];
  for (const v of fenceViolations) {
    if (v.cwd) {
      // A wrong-tree violation stays until the same lane reports the right cwd.
      if (!reports.some((r) => r.name === v.lane && r.cwd === ROOT)) next.push(v);
      continue;
    }
    const outsideAll = !inFence(v.path, ALL_FENCES);
    const clean = outsideAll
      ? !!diff && !current.has(v.path)
      : reports.some((r) => r.name === v.lane && (r.reverted || []).includes(v.path));
    if (!clean) next.push(v);
  }
  // Keyed by lane AND path: two lanes that both edit a third lane's file are two violations, and
  // one offender reverting must not clear the other's.
  const keyOf = (lane, path) => `${lane}\u0000${path}`;
  const known = () => new Set(next.map((v) => keyOf(v.lane, v.path)));
  const knownPaths = () => new Set(next.map((v) => v.path));
  for (const r of reports) {
    const reverted = r.reverted || [];
    if (r.cwd !== undefined && r.cwd !== ROOT && !next.some((v) => v.cwd && v.lane === r.name)) {
      next.push({ lane: r.name, path: `(wrong checkout) ${r.cwd}`, cwd: true });
    }
    for (const f of r.files) {
      const allowedHere = r.allow ? r.allow(f) : inFence(f, r.owns);
      if (r.allow && allowedHere) orphanTouched.add(f);
      if (!allowedHere && !exempt(f) && !reverted.includes(f) && !known().has(keyOf(r.name, f))) next.push({ lane: r.name, path: f });
    }
  }
  for (const p of current) {
    if (!inFence(p, ALL_FENCES) && !exempt(p) && !knownPaths().has(p)) next.push({ lane: "unattributed", path: p });
  }
  return next;
}

fenceViolations = await fenceCheck(
  [...lanes, { name: "contract:tokens", owns: CONTRACT_FENCE, files: contract.files, cwd: contract.cwd }],
  "Build"
);
fenceViolations.forEach((v) => log(`P0 FENCE VIOLATION: ${v.lane} touched ${v.path}`));

// Polish runs once here, after the build lanes and their fence check, so the first check wave and the fix
// rounds cover what it changes. It runs alone, so it gets the one browser port. Its `needs` join the build
// lanes' `needs` in the handoff below.
const polish = await ask(
  `Finish pass on the branded app. Load \`impeccable\` and run \`polish\` (then \`audit\`
if time allows) on the kitchen-sink route, dashboard and admin users.

You are the only agent running now. Dev server: \`CI=1 bun run dev --port 5280\` (yours alone). Save screenshots under
${outDir}/polish/ (create it). Stop your dev server and close the browser before you return.

FILE FENCE — you may edit only these paths:
${ALL_FENCES.map((p) => `  · ${p}`).join("\n")}
Anything outside them: do not edit; return it in \`needs\`. Keep every export, prop and variant name.

${REPO_RULES}
Return the files you changed, your cwd (\`git rev-parse --show-toplevel\`), and a report.`,
  { label: "build:polish", phase: "Build", agentType: "ui-builder", schema: FILES_SCHEMA }
);
if (!polish) log("WARNING: polish lane returned nothing");
const polishReport = polish ? polish.report : "polish lane returned nothing";
const polishFiles = polish ? polish.files : [];
const polishLane = {
  name: "polish",
  owns: ALL_FENCES,
  files: polishFiles,
  cwd: polish ? polish.cwd : undefined,
  changedDefaults: polish ? polish.changedDefaults ?? [] : [],
  needs: polish ? polish.needs ?? [] : [],
  report: polishReport,
};
lanes.push(polishLane);
fenceViolations = await fenceCheck([polishLane], "Build");
fenceViolations.forEach((v) => log(`P0 FENCE VIOLATION after polish: ${v.lane} touched ${v.path}`));

// ---------------------------------------------------------------------------------------------
phase("Check");

// Writers are done and the fence is checked. Everything below only reads and needs the finished tree.
// Dev servers share one Vite cache (".vite" under node_modules) and one local D1, so two browser
// agents at once give "504 Outdated Optimize Dep", blank charts and overwritten screenshots. The
// browser agents therefore run ONE AT A TIME, each on its own port and in its own screenshot folder,
// and each stops its server before it returns.
const VIEWPORTS = `at desktop (1440), WIDE desktop (1920) and mobile (390) widths, in light and dark`;
const SURFACES = `the kitchen-sink route, the dashboard, and the admin users page — ${VIEWPORTS}. Find the kitchen-sink
route under ${cfg.paths.routes}/ (read only for its URL).`;
const WIDE_CHECK = `WIDE CHECK at 1920: the page content must sit in a max-width page container, centred, not edge to edge. A
full-bleed content column at 1920 is a P1 finding; name the file that owns that page layout in \`file\`.`;
const CHECK_INPUTS = `INPUTS — judge against these, not against memory:
  · ${compDir}/comp.html  · ${compDir}/tokens.json  · the comp screenshots in ${compDir}/shots/  · ${ROOT}/${cfg.docs.product}
${cfg.docs.design} is written at Close and may not exist yet: never require it and never fail for it.
First \`ls\` each input. If any is missing, return verdict FAIL with ONE P0 finding "inputs missing at <path>"
and stop; never critique from memory.`;
const browserRules = (lane, port) => `BROWSER RULES: you are the only browser agent running now. Dev server: \`CI=1 bun run dev --port ${port}\` (yours alone). Save every
screenshot under ${outDir}/check/${lane}/ (create it) and never write to or overwrite another lane's folder. Stop your dev
server and close the browser before you return (kill the pid you started).`;

const FIND_NOTE = "Name the repo-relative file each fix belongs in, in the finding's file field.";

const CHECKS = [
  {
    name: "impeccable critique",
    browser: true,
    run: () =>
      ask(
        `Critique the rendered brand. Read-only: fix nothing.

${DESIGN_BRIEF}

${CHECK_INPUTS}

Drive ${SURFACES}
${browserRules("impeccable-critique", 5281)}
${SKILL_RULE}
Load \`impeccable\` and run \`critique\` on the screenshots. Judge pixels. Does it match the chosen comp
(${compDir}/shots/)? ${WIDE_CHECK} Report every issue P0-P3. ${FIND_NOTE}`,
        {
          label: "check:impeccable-critique",
          phase: "Check",
          // general-purpose: drives the live app and loads `impeccable` (Skill); feature-verifier has no Skill tool.
          agentType: "general-purpose",
          schema: VERDICT_SCHEMA,
        }
      ),
  },
  ...(rebuildHome
    ? [
        {
          name: "taste critique (home)",
          browser: true,
          run: () =>
            ask(
              `Critique the rebuilt HOME page. Read-only: fix nothing.

${CHECK_INPUTS}

Screenshot / ${VIEWPORTS}.
${browserRules("taste-home", 5282)}
${SKILL_RULE}
Load \`design-taste-frontend\` and run its references/critique.md loop, at most 3 rounds, scoring only (no
fixing). ${WIDE_CHECK} A score under 7.5 is reported as scored and is a P1; never round up. Put the score and the
last critique in evidence.`,
              {
                label: "check:taste-critique",
                phase: "Check",
                // general-purpose: drives the live app and loads `design-taste-frontend` (Skill).
                agentType: "general-purpose",
                schema: VERDICT_SCHEMA,
              }
            ),
        },
      ]
    : []),
  {
    name: "review-animations",
    browser: true,
    run: () =>
      ask(
        `Review the motion of the rebuilt brand. Read-only: fix nothing.

${CHECK_INPUTS}

${browserRules("motion", 5283)}
${SKILL_RULE}
Load the \`emil-design-eng\` skill (not \`review-animations\`, which the Skill tool refuses) and judge by its rules the primitives that move (dialog, sheet, dropdown-menu, tabs, accordion, button
press states). Check that the durations and easings come from the --duration-* / --ease-* tokens and
that prefers-reduced-motion collapses them. ${FIND_NOTE}`,
        {
          label: "check:review-animations",
          phase: "Check",
          // general-purpose: drives the live app and loads `emil-design-eng` (Skill); no project agent reviews motion.
          agentType: "general-purpose",
          schema: VERDICT_SCHEMA,
        }
      ),
  },
  {
    name: "verify gates",
    run: () =>
      ask(
        `Run these steps. Fix nothing.
  1. \`./scripts/verify.sh\` (typecheck, test, non-negotiables, harness, build, e2e; \`./scripts/verify.sh --list\` shows them).
     Anything that needs a dev server: \`CI=1\` and a free port of your own; stop it before you return.
  2. For each gate, note pass or fail and keep the last 20 lines of its output.
  3. Return verdict PASS only if every gate passed, else FAIL. For each failing gate return one P1 finding: the gate name
     and the first error lines as \`issue\`. If a typecheck error sits in a file outside ${cfg.paths.components}/, put that file in \`file\`
     and name the export that changed. ${FIND_NOTE}
  4. Put the output tails in \`evidence\`.`,
        { label: "check:gates", phase: "Check", agentType: "runner", effort: "low", schema: VERDICT_SCHEMA }
      ),
  },
  {
    name: "feature-verifier walk",
    browser: true,
    run: () =>
      ask(
        `Prove the branded app still works: walk sign-up, the dashboard, and admin users through the LIVE
app, golden path each, with the Playwright CLI.
${browserRules("walk", 5284)}
Do NOT write a verdict file — the Ship phase does. Return PASS or FAIL, put the screenshot
paths in evidence. ${FIND_NOTE}`,
        { label: "check:browser-walk", phase: "Check", agentType: "feature-verifier", schema: VERDICT_SCHEMA }
      ),
  },
];

const results = {}; // check name -> latest result (null if the agent returned nothing)
// The gates run first and alone (they build and run e2e), then every browser check one at a time.
async function runChecks(defs) {
  const gates = defs.filter((c) => c.name === "verify gates");
  const rest = defs.filter((c) => c.name !== "verify gates");
  if (gates.length) results[gates[0].name] = await gates[0].run();
  for (const c of rest) results[c.name] = await c.run();
}
await runChecks(CHECKS);

const checkFailed = (name) => {
  const r = results[name];
  return !r || r.verdict !== "PASS" || r.findings.some(isP0P1);
};
const openFindings = () =>
  CHECKS.flatMap((c) => {
    const r = results[c.name];
    if (!r) return [{ severity: "P1", source: c.name, issue: "check returned nothing" }];
    const blocking = r.findings.filter(isP0P1).map((f) => ({ severity: f.severity, source: c.name, issue: f.issue, file: f.file }));
    // A FAIL with no P0/P1 finding (a red gate reported as findings: []) must still block.
    if (r.verdict !== "PASS" && !blocking.length) {
      blocking.push({ severity: "P1", source: c.name, issue: `verdict ${r.verdict} with no blocking finding. Evidence: ${String(r.evidence).slice(0, 400)}` });
    }
    return blocking;
  });
const extraBlocking = [...missingBuild]; // findings the code itself raises (a missing build lane, a missing ${cfg.docs.design})
const openBlocking = () => [
  ...fenceViolations.map((v) => ({ severity: "P0", source: `fence:${v.lane}`, issue: `edited ${v.path}, outside its fence`, file: v.path })),
  ...openFindings(),
  ...extraBlocking,
];

// ---- Escalation: whatever is still open goes to the user, never rounded up --------------------
const escalations = [];
// The answer comes from args.accept[tag]. With no answer the run stops: escalate returns { pending },
// and the caller returns it from the script so the main thread can ask the user on a review page.
async function escalate(items, why, tag) {
  const said = input.accept && typeof input.accept[tag] === "boolean" ? input.accept[tag] : null;
  if (said === null) {
    log(`${items.length} item(s) ${why} — stopping to ask the user (${tag})`);
    const memAccept = await remember(
      slug,
      {
        status: "in-progress",
        log: `needs-accept (${tag}) with winning comp ${winner.id} ("${(winner.tokens && winner.tokens.name) || "unnamed"}", taste ${winner.critique.taste.score}) built on ${ROOT}. These findings ${why}: ${items.map((i) => `[${i.severity}] ${i.source}: ${i.issue}${i.file ? ` (${i.file})` : ""}`).join("; ")}. Evidence: ${outDir}/check/ (local screenshots).`,
        stopped: `needs-accept (${tag})`,
        waiting: "the user to accept the risk and ship, or stop",
        next: `re-run Workflow brand-init with resumeFromRunId set to this run and args.accept = { ...args.accept, "${tag}": true|false }`,
        todo: "decide on the open findings recorded in the log",
      },
      "memory:record:needs-accept:" + tag,
      tag === "post-fix" ? "Fix" : "Close"
    );
    return {
      pending: {
        memory: memAccept,
        status: "needs-accept",
        tag,
        why: `These findings ${why}`,
        items,
        evidence: `${outDir}/check/ (screenshots, one folder per check)`,
        review: `${outDir}/accept-${tag}.html`,
        next: `Write the review page at ${outDir}/accept-${tag}.html (run \`npx -y lavish-axi playbook table\` and \`playbook input\` first; style it with the app's tokens from ${cfg.paths.tokens}). One row per item as scored, with its severity, source, issue and file; do not round up. Beside each row, the screenshots from ${outDir}/check/ that show it (relative paths, never a leading /). Leave annotation on so the user can point at a screenshot. ${runSummaryNote(slug, "brand-init")} End with ONE form: "Ship with these open (accept the risk)" or "Stop", and one submit that calls window.lavish.queuePrompt once with data { accept: true|false }. Open it with \`npx -y lavish-axi <page>\`, tell the user it is open, then run \`npx -y lavish-axi poll <page>\` in the foreground and re-run it if it times out. Read the answer and any notes, post \`npx -y lavish-axi reply <page> --agent-reply "<what happens next>"\`, then re-run with resumeFromRunId set to this run and args.accept = { ...args.accept, "${tag}": true|false }. Keep every other arg. If lavish will not start, show the items in chat and ask there.`,
      },
    };
  }
  log(`${items.length} item(s) ${why} — user ${said ? "accepted" : "declined"} (${tag})`);
  const answer = { decision: said ? "accept" : "stop", notes: said ? "accepted by the user" : "stopped by the user" };
  escalations.push({
    ...answer,
    about: items.map((i) => `${i.source}: ${i.issue}`),
    gates: items.filter((i) => i.source === "verify gates").map((i) => i.issue),
  });
  return answer;
}
const accepted = () => escalations.length > 0 && escalations.every((e) => e.decision === "accept");
// Accepting a visual defect is not accepting a red gate. Ship may pass a red gate only when the user
// was shown that gate failing and accepted it.
const acceptedGateFailures = () => (accepted() ? escalations.flatMap((e) => e.gates) : []);

// ---------------------------------------------------------------------------------------------
phase("Fix");

const unresolved = []; // { file, why, from } things no lane could do: outside the app root, or owned by another lane
const noteUnresolved = (u) => { if (!unresolved.some((x) => x.file === u.file && x.from === u.from)) unresolved.push(u); };
// A fix lane that returned nothing: everything it was handed is still owed.
// Items that came from a check finding carry `findingKey`, so a later round that fixes the finding
// clears the entry (see the prune before `stillOpen`). A `needs` item has no check that could confirm it.
const findingKey = (f) => `${f.source}|${f.issue}`;
const failedLane = (name, items) =>
  items.forEach((f) =>
    noteUnresolved({
      file: f.file || `(${f.source})`,
      why: `lane ${name} returned nothing; still open: [${f.severity}] ${f.issue}`,
      from: name,
      findingKey: f.source.startsWith("needs:") ? undefined : findingKey(f),
    })
  );
const outsideApp = (f) => !!f.file && !f.file.startsWith(cfg.paths.appRoot) && !f.source.startsWith("fence:");
const offenderOf = laneByName;

const contractFixPrompt = (fs, tag) => `Lane: contract:tokens, FIX PASS ${tag}. You are the CONTRACT lane; it already built. You own ${CONTRACT_FENCE.join(" and ")} and nothing else.

${DESIGN_BRIEF}

Fix ONLY these open findings, inside your fence, and change nothing else:
${fs.map((f) => `  · [${f.severity}] ${f.source}: ${f.issue}${f.file ? ` (${f.file})` : ""}`).join("\n")}

AA rule: a text pair under 4.5:1 gets its lightness adjusted, keeping hue and chroma, in light AND dark; list each change
(token, before, after). A font-link finding means fixing the <link> tags for tokens.fonts hrefs in ${cfg.paths.rootLayout} (preconnect plus
stylesheet). A file you need but do not own: do not edit it, return it in \`needs\`. No dev server and no browser in this lane.
Load \`impeccable\` for the colour work. The tokens in ${cfg.paths.tokens} beat every skill.

${REPO_RULES}
Return the files you changed, your cwd (\`git rev-parse --show-toplevel\`), and a report.`;

const repairPrompt = (name, owns, vs) => `Lane: ${name}. FENCE REPAIR. You edited paths outside your fence:
${vs.map((v) => `  · ${v.path}`).join("\n")}
Your fence:
${owns.map((p) => `  · ${p}`).join("\n")}
Undo ONLY your own edit to each path. If the path sits outside every lane's fence, restore it with
\`git checkout HEAD -- <path>\`. If it sits inside another lane's fence, reverse just the lines you
changed by hand: never git checkout a file another lane owns, it holds their work. Never delete an
untracked file outside ${cfg.paths.appRoot}. Never touch these paths, which were dirty before the build:
${[...preDirty].join(", ") || "(none)"}.
Change nothing else. Return the files you changed, the paths you actually reverted in \`reverted\`, your cwd, and a report.`;

const toReport = (name, lane, r, none) => ({
  name,
  owns: lane.owns,
  files: r ? r.files : [],
  cwd: r ? r.cwd : undefined,
  reverted: [],
  changedDefaults: r ? r.changedDefaults ?? [] : [],
  needs: r ? r.needs ?? [] : [],
  report: r ? r.report : none,
});

// Fix machinery, shared by the first-build handoff and every fix round. `items` are finding-shaped
// ({ severity, source, issue, file }). Step 1: each owning lane (the contract lane included) fixes its own, in
// parallel. Step 2: a `needs` entry that another lane owns goes to that lane in one more parallel wave. Step 3: items
// no lane owns, plus unowned `needs`, go to ONE fix:orphans lane that runs alone after everything else. Anything outside
// the app root, or still owned by a lane after step 2, lands in `unresolved` and is escalated.
async function fixLanes(items, tag) {
  const reports = [];
  const orphanQ = [];
  const route = (list) => {
    const by = new Map();
    for (const f of list) {
      const owner = f.file ? ownerOf(f.file) : null;
      if (owner) by.set(owner.name, [...(by.get(owner.name) || []), f]);
      else if (outsideApp(f)) log(`Finding outside ${cfg.paths.appRoot}, no lane may fix it, escalating: ${f.file}`); // tagged at escalation
      else orphanQ.push(f);
    }
    return by;
  };
  const wave = (by, n) =>
    parallel(
      [...by.entries()].map(([name, fs]) => () => {
        const lane = laneByName(name);
        const prompt =
          name === CONTRACT_LANE.name
            ? contractFixPrompt(fs, tag)
            : lanePrompt(
                lane,
                `\nFIX PASS ${tag}. This lane already built. Fix ONLY these open findings, inside your fence, and change nothing else:
${fs.map((f) => `  · [${f.severity}] ${f.source}: ${f.issue}${f.file ? ` (${f.file})` : ""}`).join("\n")}\n`
              );
        const opts = { label: `fix:${tag}:${name}${n > 1 ? ":handoff" : ""}`, phase: "Fix", agentType: "ui-builder", schema: FILES_SCHEMA };
        // A lane that returns nothing gets one retry. If it is still empty, the work it was handed
        // must not vanish with it: every assigned item goes to `unresolved`, which blocks Ship.
        return ask(prompt, opts)
          .then((r) => r || ask(prompt, { ...opts, label: `${opts.label}:retry` }))
          .then((r) => {
            if (!r) failedLane(name, fs);
            return toReport(name, lane, r, "fix lane returned nothing twice");
          });
      })
    );
  // Turn a wave's `needs` into next-wave items, orphan items or unresolved entries.
  const handoffs = (rs, last) => {
    const next = [];
    for (const r of rs.filter(Boolean)) {
      for (const n of r.needs || []) {
        const owner = n.file.startsWith(cfg.paths.appRoot) ? ownerOf(n.file) : null;
        if (!n.file.startsWith(cfg.paths.appRoot)) noteUnresolved({ file: n.file, why: n.why, from: r.name });
        else if (owner && owner.name === r.name) continue;
        else {
          const item = { severity: "P1", source: `needs:${r.name}`, issue: n.why, file: n.file };
          if (!owner) orphanQ.push(item);
          else if (last) noteUnresolved({ file: n.file, why: `${n.why} (owned by lane ${owner.name})`, from: r.name });
          else next.push(item);
        }
      }
    }
    return next;
  };
  const w1 = (await wave(route(items), 1)).filter(Boolean);
  reports.push(...w1);
  const again = handoffs(w1, false);
  if (again.length) {
    const w2 = (await wave(route(again), 2)).filter(Boolean);
    reports.push(...w2);
    handoffs(w2, true);
  }
  if (orphanQ.length) {
    const solo = await ask(
      `FIX PASS ${tag}, lane fix:orphans. You run alone: every other lane has finished. These items name no
file inside any lane's fence:
${orphanQ.map((f) => `  · [${f.severity}] ${f.source}: ${f.issue}${f.file ? ` (${f.file})` : ""}`).join("\n")}

${DESIGN_BRIEF}

FILE FENCE — you may edit any file under ${cfg.paths.appRoot} EXCEPT these, which other lanes own:
${ALL_FENCES.map((p) => `  · ${p}`).join("\n")}
You may NEVER edit anything under scripts/, any test (__tests__, *.test.*, *.spec.*), or any config file. A finding that
needs anything outside that fence: do not edit; return it in \`needs\`. Keep every export, prop and variant name, and every
default prop value. No dev server and no browser in this lane. ${REPO_RULES}
Return the files you changed, your cwd (\`git rev-parse --show-toplevel\`), and a report.`,
      { label: `fix:${tag}:orphans`, phase: "Fix", agentType: "ui-builder", schema: FILES_SCHEMA }
    );
    if (!solo) failedLane("fix:orphans", orphanQ);
    for (const n of (solo && solo.needs) || []) noteUnresolved({ file: n.file, why: n.why, from: "fix:orphans" });
    reports.push({ ...toReport("fix:orphans", { owns: [] }, solo, "orphans fix returned nothing"), allow: orphanMayEdit });
  }
  return reports;
}

// Which checks can a set of changed files affect? Any change re-runs the gates.
const affectedChecks = (files) => {
  const names = new Set();
  if (!files.length) return names;
  names.add("verify gates");
  for (const f of files) {
    if (f === cfg.paths.tokens || f === cfg.paths.rootLayout || f.startsWith(`${cfg.paths.components}/`)) {
      ["impeccable critique", "taste critique (home)", "feature-verifier walk", "review-animations"].forEach((n) => names.add(n));
    } else if (f === cfg.paths.home) names.add("taste critique (home)");
    else if (f.startsWith(`${cfg.paths.locales}/`)) ["impeccable critique", "feature-verifier walk", "taste critique (home)"].forEach((n) => names.add(n));
    else if (f.startsWith(cfg.paths.appRoot)) ["impeccable critique", "feature-verifier walk"].forEach((n) => names.add(n)); // shells, auth shell, other routes
  }
  return names;
};
// Re-run every check the changed files could affect, plus any that failed.
const rerunAfter = async (reports) => {
  const changed = reports.flatMap((r) => [...(r.files || []), ...(r.reverted || [])]);
  const hit = affectedChecks(changed);
  const todo = CHECKS.filter((c) => checkFailed(c.name) || hit.has(c.name));
  if (todo.length) {
    log(`Re-running ${todo.length} check(s): ${todo.map((c) => c.name).join(", ")}`);
    await runChecks(todo);
  }
};

// First-build `needs` (a lane hit a file it does not own) are routed even when every check passes.
{
  const allNeeds = [...lanes, { name: CONTRACT_LANE.name, needs: contract.needs || [] }].flatMap((l) =>
    (l.needs || []).filter((n) => ownerOf(n.file)?.name !== l.name).map((n) => ({ severity: "P1", source: `needs:${l.name}`, issue: n.why, file: n.file }))
  );
  // No lane may edit outside the app root, so those needs go straight to `unresolved` (escalated, blocks Ship)
  // rather than into fixLanes, where they would only be logged.
  allNeeds.filter(outsideApp).forEach((f) => noteUnresolved({ file: f.file, why: f.issue, from: f.source }));
  const buildNeeds = allNeeds.filter((f) => !outsideApp(f));
  if (buildNeeds.length) {
    log(`Build handoff: ${buildNeeds.length} file(s) a lane needed but did not own`);
    const handoffReports = await fixLanes(buildNeeds, "handoff");
    lanes.push(...handoffReports.map((r) => ({ ...r, name: `${r.name} (handoff)` })));
    fenceViolations = await fenceCheck(handoffReports, "Fix");
    fenceViolations.forEach((v) => log(`P0 FENCE VIOLATION still open: ${v.lane} touched ${v.path}`));
    await rerunAfter(handoffReports);
  }
}

// Up to two rounds. First the OFFENDING lane repairs its own out-of-fence edits, alone (plan error
// table: "P0; rerun that lane alone"); then the owning lane (by fence) fixes each finding; then every check the
// changed files could affect runs again, plus any that failed. Anything that survives goes to the user.
for (let round = 1; round <= 2 && openBlocking().length; round++) {
  const open = openBlocking();
  log(`Fix round ${round}: ${open.length} open P0/P1`);

  // A. Fence violations. The offender repairs first, so that no repair overlaps a fix lane.
  const byOffender = new Map();
  const strays = [];
  for (const v of fenceViolations.filter((x) => !x.cwd)) {
    const lane = offenderOf(v.lane);
    if (lane) byOffender.set(lane.name, { lane, vs: [...(byOffender.get(lane.name)?.vs || []), v] });
    else strays.push(v);
  }
  const runRepair = ({ lane, vs }) =>
    ask(repairPrompt(lane.name, lane.owns, vs), {
      label: `fix:${round}:repair:${lane.name}`,
      phase: "Fix",
      agentType: "ui-builder",
      schema: FILES_SCHEMA,
    }).then((r) => ({ name: lane.name, owns: lane.owns, files: r ? r.files : [], cwd: r ? r.cwd : undefined, reverted: r ? r.reverted ?? [] : [], report: r ? r.report : "repair lane returned nothing" }));
  // Two offenders on one path would edit the same file at once, so any shared path makes the
  // repairs run one at a time.
  const offenders = [...byOffender.values()];
  const repairPaths = offenders.flatMap(({ vs }) => vs.map((v) => v.path));
  const repairs = [];
  if (new Set(repairPaths).size < repairPaths.length) {
    for (const o of offenders) repairs.push(await runRepair(o));
  } else {
    repairs.push(...(await parallel(offenders.map((o) => () => runRepair(o)))));
  }
  if (strays.length) {
    const r = await ask(
      `Restore these files, which no lane may edit. For each path, in order:
${strays.map((v) => `  · ${v.path} (touched by ${v.lane})`).join("\n")}
  1. If the path is in this list, skip it (dirty before the build): ${[...preDirty].join(", ") || "(none)"}.
  2. If the path sits inside a lane's fence, skip it and say so: it holds that lane's work.
  3. If it is tracked: \`git checkout HEAD -- <path>\`.
  4. If it is untracked: delete it ONLY if it is under ${cfg.paths.appRoot}; anywhere else leave it and say so.
  5. Touch nothing else.
Return \`files\` and \`reverted\` (the paths you restored or deleted), \`cwd\` (\`git rev-parse --show-toplevel\`), and a one-line \`report\`.`,
      { label: `fix:${round}:revert-strays`, phase: "Fix", agentType: "runner", effort: "low", schema: FILES_SCHEMA }
    );
    if (!r) log("WARNING: revert agent returned nothing");
    repairs.push({ name: "revert-strays", owns: [], files: r ? r.files : [], cwd: r ? r.cwd : undefined, reverted: r ? r.reverted ?? [] : [], report: r ? r.report : "revert agent returned nothing" });
  }

  // B. Findings, routed by owner (the contract lane included); unowned ones go to fix:orphans.
  const fixed = await fixLanes(open.filter((x) => !x.source.startsWith("fence:")), round);
  const roundReports = [...repairs, ...fixed].filter(Boolean);
  lanes.push(...roundReports.map((r) => ({ ...r, name: `${r.name} (fix ${round})` })));

  fenceViolations = await fenceCheck(roundReports, "Fix");
  fenceViolations.forEach((v) => log(`P0 FENCE VIOLATION still open: ${v.lane} touched ${v.path}`));

  await rerunAfter(roundReports);
}

// A failed lane's finding that a later round fixed is no longer owed.
{
  const openKeys = new Set(openBlocking().map(findingKey));
  for (let i = unresolved.length - 1; i >= 0; i--) {
    if (unresolved[i].findingKey && !openKeys.has(unresolved[i].findingKey)) unresolved.splice(i, 1);
  }
}
const stillOpen = openBlocking().map((f) =>
  outsideApp(f) ? { ...f, issue: `needs a human or a separate task (outside ${cfg.paths.appRoot}): ${f.issue}` } : f
);
for (const u of unresolved) {
  stillOpen.push({ severity: "P1", source: `unresolved:${u.from}`, issue: `needs a human or a separate task: ${u.why}`, file: u.file });
}
if (stillOpen.length) {
  const e = await escalate(stillOpen, "survived two fix rounds", "post-fix");
  if (e.pending) return e.pending;
}
let mayShip = !stillOpen.length || accepted();

// ---------------------------------------------------------------------------------------------
phase("Close");

// Polish ran in Build and the Check wave and fix rounds covered it. DESIGN.md writes no app file, so no
// check reruns after it; the fence check below still runs once after the documenter.
if (mayShip) {
  // DESIGN.md comes from the shipped artifact, so it follows the checked, polished tree.
  const doc = await ask(
    `Write ${ROOT}/${cfg.docs.design} from the SHIPPED app, not from intentions. Read ${cfg.paths.tokens},
${cfg.paths.rootLayout}, ${cfg.paths.primitives}/ and ${cfg.paths.components}/brand/, and the chosen comp at ${compDir}.

${DESIGN_BRIEF}

Record: colour tokens (light and dark) with their roles, type scale and pairings, radius and density,
motion tokens and the reduced-motion rule, the wordmark, the voice lines, component conventions, and
this contrast log from the contract lane:
${contract.report}
${redo ? `This is a redo: replace the old ${cfg.docs.design} outright. Carry nothing over from it that the shipped app does not show.\n` : ""}Write only ${cfg.docs.design} (and its sidecar if your instructions call for one). When done, confirm with
\`ls -l ${cfg.docs.design}\`, then return written=true and every file you wrote.`,
    {
      label: "close:design-md",
      phase: "Close",
      agentType: "impeccable:impeccable-documenter",
      schema: obj({ written: BOOL, files: STRS }),
    }
  );
  if (!doc || !doc.written || !doc.files.includes(cfg.docs.design)) {
    extraBlocking.push({ severity: "P1", source: "close:design-md", issue: `the documenter did not confirm ${cfg.docs.design} was written`, file: cfg.docs.design });
    mayShip = false;
  }

  // The documenter ran after the last check, so check the whole tree once more for strays.
  const before = new Set(fenceViolations.map((v) => v.path));
  fenceViolations = await fenceCheck([{ name: "close:design-md", owns: [], files: doc ? doc.files : [] }], "Close");
  const fresh = fenceViolations.filter((v) => !before.has(v.path));
  fresh.forEach((v) => log(`P0 FENCE VIOLATION after Close: ${v.lane} touched ${v.path}`));
  if (fresh.length) {
    const e = await escalate(
      fresh.map((v) => ({ severity: "P0", source: `fence:${v.lane}`, issue: `edited ${v.path}, outside its fence`, file: v.path })),
      `appeared after the ${cfg.docs.design} pass`,
      "post-close-fence"
    );
    if (e.pending) return e.pending;
    if (!accepted()) mayShip = false;
  }
}

const finalBlocking = openBlocking();
const synthesis = await ask(
  `Synthesise the outcome of the /brand-init run. Do not edit any files — this is a report.

Chosen brand: comp ${winner.id} ("${tokens.name ?? "unnamed"}"). Rebuilt home: ${rebuildHome ? "yes" : "no"}.

Contract lane report:
${contract.report}

Lane reports (build and fix):
${lanes.map((l) => `--- ${l.name} ---\n${l.report}`).join("\n\n")}

DEFAULT AND BEHAVIOUR CHANGES the lanes reported (the promise was that names, defaults and behaviour stay):
${lanes.flatMap((l) => (l.changedDefaults || []).map((d) => `  · ${l.name}: ${d}`)).join("\n") || "  (none reported)"}

Needs no lane could meet: ${unresolved.length ? JSON.stringify(unresolved) : "none"}

Fence violations still open (each is a P0): ${fenceViolations.length ? JSON.stringify(fenceViolations) : "none"}

Latest check results:
${CHECKS.map((c) => `--- ${c.name} ---\n${results[c.name] ? JSON.stringify(results[c.name], null, 1) : "returned nothing"}`).join("\n\n")}

Escalations: ${escalations.length ? JSON.stringify(escalations) : "none needed"}
Other blocking: ${extraBlocking.length ? JSON.stringify(extraBlocking) : "none"}
Polish: ${polishReport}

Produce, in this order:
1. STATE — is the brand applied, and what is demonstrably true (cite evidence, not claims).
2. BLOCKING — every open P0/P1 with the file and the fix, most severe first, and which lane owns it. "none" if none.
3. LANE COLLISIONS — fence violations and any drift from the tokens.
4. HUMAN DECISIONS — anything a person must still choose (a taste score under 7.5, a contrast change that
   shifts the brand, an export that had to change, EVERY default or behaviour change listed above, and each need no
   lane could meet), and the escalation answers if there were any. Never
   decide these yourself.

Be blunt about what is unfinished.`,
  {
    label: "close:synthesis",
    phase: "Close",
    // general-purpose: no project agent has this job (a blunt report from the run's own results), and a narrower type would bring the wrong instructions.
    agentType: "general-purpose",
    effort: "high",
  }
);

// ---------------------------------------------------------------------------------------------
phase("Ship");

// One shape on every path: { shipped, reason?, gatesGreen?, verdictWritten?, commit?, pr? }.
let ship = { shipped: false, reason: `open P0/P1 or a missing ${cfg.docs.design}, and the user did not accept them` };
if (mayShip) {
  const lastCritique = results["impeccable critique"] ? JSON.stringify(results["impeccable critique"], null, 1) : "(the impeccable critique returned nothing)";
  const walk = results["feature-verifier walk"];
  const motionRes = results["review-animations"];
  // Everything any lane reported changing (fix:orphans edits land outside ALL_FENCES) is staged too.
  const reportedFiles = [...new Set([...lanes.flatMap((l) => l.files || []), ...contract.files, ...polishFiles, ...orphanTouched])].filter((f) => !ignored(f));
  const STAGE = [...new Set([...ALL_FENCES, ...reportedFiles])].concat([cfg.docs.product, cfg.docs.design, `${cfg.docs.design.replace(/\.md$/, ".*")} (its sidecar, if the documenter wrote one)`]);
  const shipped = await ask(
    `Ship the brand. You own the verdict file, the commit and the PR for this run.

${DESIGN_BRIEF}

Open findings the user explicitly accepted in an escalation review: ${accepted() ? "YES — " + JSON.stringify(escalations) : "no"}.

Steps, in order:
  1. \`./scripts/verify.sh\` (every gate, including build and e2e). Also \`bun run typecheck\` and confirm no
     call site outside ${cfg.paths.components}/ changed.
  2. IF ANY GATE IS RED: ${
      acceptedGateFailures().length
        ? `continue ONLY if every red gate was already failing in this evidence the user saw and accepted:
${JSON.stringify(acceptedGateFailures())}
     Then skip the verdict and the commit below, and say in the PR which gate failed. Any OTHER red gate:
     STOP as below.`
        : "STOP."
    } STOP means: change nothing, write no verdict file, commit nothing, push nothing, open no PR.
     Return shipped=false, gatesGreen=false and the failing gate in reason.
     IF every gate is green:
     · Write ${outDir}/verdict.md: a first line \`Verdict: PASS\` (or FAIL, or PARTIAL), then the steps and
       findings (screenshots under ${outDir}/check/<lane>/, one folder per check; list their paths). The body pastes the last impeccable
       critique WHOLE (AGENTS.md rule), then the review-animations verdict, then the feature-verifier
       walk, then the fix rounds that ran. If a P0/P1 was accepted by the user, say so and write the
       verdict as the facts are; do not write PASS over an unresolved P0/P1 — use FAIL or PARTIAL.
       Last impeccable critique:
${lastCritique}
       review-animations: ${motionRes ? JSON.stringify(motionRes) : "returned nothing"}
       walk: ${walk ? JSON.stringify(walk) : "returned nothing"}
       Escalation answers: ${escalations.length ? JSON.stringify(escalations) : "none"}
     · The design-system decision lives in ${cfg.docs.design} (already written). Do not edit it. Keep this for the PR body: the winner and why (cite its taste score and
       critique), then the comps that lost and why:
${rejected.length ? rejected.map((r) => `       · comp ${r.id}: ${r.why}`).join("\n") : "       · (none)"}
  4. Extend scripts/seed-preview.ts only if the run changed seeded data (it should not); stage it only then.
  5. ONE commit, one PR. Stage EXPLICIT paths with \`git add -- <paths>\`, never a wholesale \`git add ${cfg.paths.appRoot}\` or \`-A\`:
${STAGE.map((p) => `       · ${p}`).join("\n")}
     After \`git add\`, run \`git status --porcelain\`. These files were reported changed by a lane:
${reportedFiles.map((p) => `       · ${p}`).join("\n") || "       · (none)"}
     If ANY of them still shows as modified or untracked and not staged, do NOT commit: stop and return shipped=false
     with a reason naming each unstaged file. (A file with no change against HEAD is fine.)
     Do NOT stage anything under .verify/ (the comps, screenshots and verdict.md stay local), or draw
     files. Check \`git status --short\` afterwards: anything modified and unstaged that is not one of
     those is a surprise, so name it in your note. Commit message:
     \`feat(brand): ${tokens.name ?? "new"} brand — tokens, primitives, ${cfg.docs.design}\`, ending with the
     Co-Authored-By line for the model you run as (\`Co-Authored-By: <your model name> <noreply@anthropic.com>\`).
     Push the branch and open the PR with the \`engineering-toolkit:pr-format\` skill's layout: the pick
     screenshots (desktop and mobile, light and dark) and the final critique summary in the body, the
     contents of ${outDir}/verdict.md, the winning comp and why it won (its taste score), the list of
     screenshot paths, the rejected comps and why, and any open finding named plainly. Before the closing line, add a \`## Run\` heading and the output of \`bun scripts/run-telemetry.ts summary brand-init --markdown\` (run from ROOT; if it fails, leave the section out). End the PR body with:
     🤖 Generated with [Claude Code](https://claude.com/claude-code)
  6. DO NOT MERGE.

Synthesis to ground your account:
${synthesis}

Return shipped (true only if a commit and a PR exist), gatesGreen, verdictWritten, the commit sha,
the PR url, and a reason when shipped is false or anything went wrong.`,
    {
      label: "ship:record-commit-pr",
      phase: "Ship",
      // general-purpose: writes the verdict, stops on a red gate, commits, and opens the PR with a skill (Skill tool); runner makes no judgment.
      agentType: "general-purpose",
      schema: obj({ shipped: BOOL, reason: STR, gatesGreen: BOOL, verdictWritten: BOOL, commit: STR, pr: STR }, ["shipped"]),
    }
  );
  ship = shipped ?? { shipped: false, reason: "ship agent returned nothing" };
}

// One writer, once, after every other lane. Status is done only when a PR exists.
const memFinal = await remember(
  slug,
  {
    status: ship.shipped ? "done" : "blocked",
    log: `${ship.shipped ? "PR open, not merged: the user merges." : "Not shipped."} Winner: comp ${winner.id} ("${tokens.name ?? "unnamed"}"), taste score ${winner.critique.taste.score} (scored, not rounded). Rebuilt home: ${rebuildHome ? "yes" : "no"}. Redo of an existing brand: ${redo}. Ship: shipped=${ship.shipped}${ship.reason ? `; reason: ${ship.reason}` : ""}. Verdict ${ship.verdictWritten ? outDir + "/verdict.md (local, not committed)" : "not written"}; ${cfg.docs.design} ${mayShip ? "written" : "not written"}.${finalBlocking.length ? "" : " No open blocking findings."}`,
    next: ship.shipped ? "user reviews and merges the PR" : "resolve the blockers in the todo list and re-run, or fix by hand",
    decision: [
      `comp ${winner.id} ("${tokens.name ?? "unnamed"}") is the brand — the user picked it on the review page after the critiques; taste ${winner.critique.taste.score}; taste notes: ${JSON.stringify(winner.critique.taste.notes ?? "")} — brand-init run`,
      ...rejected.map((r) => `comp ${r.id} was not picked — ${r.why} — brand-init run`),
    ],
    link: [ship.pr ? `PR: ${ship.pr}` : "", ship.commit ? `commit: ${ship.commit}` : ""],
    todo: [
      ...finalBlocking.map((f) => `[${f.severity}] ${f.source}: ${f.issue}`),
      ...unresolved.map((u) => `${u.file}: ${u.why}`),
      ship.shipped ? "merge the PR after review" : "resolve the blockers above and re-run, or fix by hand",
    ],
  },
  "memory:record:ship",
  "Ship"
);

return {
  pick: winner.id,
  comps: lastRound ? lastRound.comps.map((c) => ({ id: c.id, name: c.tokens && c.tokens.name, taste: c.critique.taste.score })) : [],
  failed: failedAll,
  rejected,
  rebuildHome,
  lanes: [
    { name: "contract:tokens", owns: CONTRACT_FENCE, report: contract.report },
    ...lanes.map((l) => ({ name: l.name, owns: l.owns, report: l.report })),
  ],
  fenceViolations,
  blockingFindings: finalBlocking,
  verdicts: CHECKS.map((c) => ({
    check: c.name,
    verdict: results[c.name] && results[c.name].verdict === "PASS" ? "PASS" : "FAIL",
    evidence: results[c.name] ? results[c.name].evidence : "check returned nothing",
  })),
  escalations,
  unresolved,
  designMd: mayShip ? cfg.docs.design : null,
  synthesis,
  ship,
  memory: { recalled: recalled ?? null, recorded: memFinal ?? null },
};
