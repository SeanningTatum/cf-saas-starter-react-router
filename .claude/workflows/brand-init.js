export const meta = {
  name: "brand-init",
  description:
    "Give a fork its own brand in one run — preflight, brief, three comps drawn and critiqued in parallel, a pick through brain review, tokens and every primitive rebuilt on disjoint fences, checks, fix rounds, DESIGN.md, then brain records, one commit and one PR",
  whenToUse:
    "A fresh fork that still wears the starter's look. Not for one colour or one component, not on a repo with live users whose brand is not changing (it rewrites 55 primitives), not as a throwaway exploration on a branch you care about.",
  phases: [
    { title: "Preflight", detail: "clean tree, green baseline, one feature in progress, no brand yet, branch off main" },
    { title: "Brief", detail: "the impeccable init interview as a brain review; writes PRODUCT.md" },
    { title: "Draw", detail: "taste draws the directions, then one comp lane per direction in parallel" },
    { title: "Critique", detail: "taste loop, impeccable critique, motion review per comp; sameness check; one redraw" },
    { title: "Pick", detail: "the user picks a comp (and the home question) in a brain review" },
    { title: "Contract", detail: "one lane writes tokens into app/app.css and the font link into app/root.tsx" },
    { title: "Build", detail: "primitive and shared lanes own disjoint files and run concurrently; fence check" },
    { title: "Check", detail: "design critiques, motion review, gates and a browser walk at once" },
    { title: "Fix", detail: "up to two rounds: owning lane per open finding, re-run failing checks; escalate the rest" },
    { title: "Close", detail: "polish, DESIGN.md, synthesis" },
    { title: "Ship", detail: "brain verify, verification, docs, progress, one commit, one PR; no merge" },
  ],
};

/**
 * WHY THIS EXISTS
 *   A brand is chosen by looking at it, then applied everywhere at once. This is ONE self-contained
 *   workflow: there is no slash command in front of it. It draws three rival comps in parallel, lets
 *   critics judge them on pixels, asks the user to pick, then turns the winner into the real design
 *   system. The token layer is the one sequential step; after it, 55 primitives and a few shared
 *   components share no file, so they build in parallel. It ends by recording the work in the brain
 *   and opening a PR, so everything lives in one place.
 *
 * HOW THE HUMAN STEPS WORK
 *   Agents cannot chat with the user, but they can ask through `brain review`. An agent writes an
 *   HTML plan, runs `brain review open <file> --feature brand-init`, then `brain review poll <file>`
 *   (long-polls until the user answers in the browser; run it again on timeout) and returns the
 *   answers. Every human step is that: the brief, the pick, and an escalation.
 *
 * THE RULE THAT KEEPS IT SAFE
 *   Parallel writers own **disjoint paths**. The fences are hardcoded below, every lane prompt
 *   repeats its own, and after the Build phase the script compares what each lane says it changed
 *   (plus the git diff) against the fences. A lane that edits outside its fence is a P0.
 *
 * THE LIMITS
 *   It never merges. It commits once and opens one PR.
 *
 * args (all optional):
 *   { brief?: string,        a line about the product, to prefill the interview
 *     sector?: string,       closest taste sector, if you already know it
 *     redo?: boolean,        replace an existing DESIGN.md; the old brand becomes the anti-reference
 *     rebuildHome?: boolean  leave unset to ask on the pick card }
 */
const input = args && typeof args === "object" ? args : {};
for (const [k, t] of [["brief", "string"], ["sector", "string"], ["redo", "boolean"], ["rebuildHome", "boolean"]]) {
  if (input[k] !== undefined && typeof input[k] !== t) {
    log(`brand-init: args.${k} must be a ${t}, got ${JSON.stringify(input[k])}. Nothing ran.`);
    return { error: `args.${k} must be a ${t}` };
  }
}
const redo = input.redo === true;
const slug = "brand-init";
const outDir = ".brain/shots/brand-init";
const product = "PRODUCT.md";

const REPO_RULES = `Repo rules: the tokens in app/app.css beat every skill. Use semantic tokens only: no raw
hex and no arbitrary Tailwind values in app code. Do not run git commit and do not write to the brain
unless your task says so. Dev servers: \`CI=1 bun run dev --port <port>\` on the port you were given.`;

// How an agent talks to the user. Used by every human step.
const REVIEW_HOWTO = `HOW TO ASK THE USER (the only way you can): write ONE self-contained HTML file, using the
\`brain-axi:brain-plan\` skill's style block and decision-card snippet (\`brain playbook plan --ref style\`
and \`--ref decision-card\` if the skill is not loaded). Then, in the foreground:
    brain review open <file> --feature brand-init
    brain review poll <file>
The poll long-polls until the user answers in the browser. Never background it and never stop while it
waits: on a timeout, run it again. Answers arrive as \`decision\` prompts. If the user adds a comment,
apply it to the same file and poll again with \`--agent-reply "<what you changed>"\`. Stop on
\`ended_by: user\`. When every decision is in, run \`brain review end <file>\`. Report only what the user
actually answered; never fill in an answer for them.`;

const FINDINGS = {
  type: "array",
  items: {
    type: "object",
    required: ["severity", "issue"],
    properties: {
      severity: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
      issue: { type: "string" },
      file: { type: "string", description: "Repo-relative file the fix belongs in, if known" },
    },
    additionalProperties: false,
  },
};

// Run an agent thunk; one retry if it returns nothing or throws. Returns null after two failures.
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

// =============================================================================================
phase("Preflight");

const pre = await agent(
  `Pre-flight for /brand-init. Check each item, in order, and stop at the first failure. Fix nothing
except where an item says to.

  1. Brand check. If DESIGN.md exists at the repo root and redo is ${redo}: when redo is false, fail with
     exactly: A brand exists. Run Workflow({ name: "brand-init", args: { redo: true } }) to replace it.
     (When redo is true, leave DESIGN.md in place; it is the brand to move away from.)
  2. Clean tree. \`git status --short\`. Ignore anything under .brain/ and any plans/brand-*.html. If
     anything else is dirty, fail and name the files: parallel lanes writing over uncommitted work make
     the diff unreadable.
  3. Baseline. \`brain verify --stage baseline\`. If red, fail and name the failing gate.
  4. Scope policy. \`brain features list --status in-progress\`. If a feature other than brand-init is
     open, fail and name it. Do not block it for the user.
  5. Claim the feature: \`brain features add brand-init --name "Brand init"\` (skip if it exists), then
     \`brain features set brand-init --status in-progress\`.
  6. Branch. If on main, \`git switch -c feat/brand-init\`. Otherwise stay.
Return ok=false with a one-line reason for the first failure, else ok=true.`,
  {
    label: "preflight",
    phase: "Preflight",
    schema: {
      type: "object",
      required: ["ok", "reason", "branch"],
      properties: { ok: { type: "boolean" }, reason: { type: "string" }, branch: { type: "string" } },
      additionalProperties: false,
    },
  }
);
if (!pre || !pre.ok) {
  const reason = pre ? pre.reason : "pre-flight agent returned nothing";
  log(`Pre-flight failed: ${reason}`);
  return { error: reason };
}
log(`Pre-flight green on ${pre.branch}`);

// =============================================================================================
phase("Brief");

const brief = await agent(
  `Run the impeccable \`init\` interview, but through a brain review instead of chat.

Load \`impeccable:impeccable\` and read its \`init\` instructions to get the questions it asks about the
product, the users and the tone. ${redo ? "This is a redo: also ask what the old brand (DESIGN.md) got wrong." : ""}
Prefill the answers where you can:
  · args.brief: ${JSON.stringify(input.brief ?? null)}
  · args.sector: ${JSON.stringify(input.sector ?? null)}
  · the repo: README.md, AGENTS.md, package.json, app/routes/home.tsx, the i18n locale files.

${
  "PRODUCT.md exists next to this? Check. If it does and redo is " + redo + ": when redo is false, SHOW the existing PRODUCT.md in the review for confirm or edit instead of asking afresh; when redo is true, prefill from it."
}

Write plans/brand-brief.html: each question a review prompt (a decision card or a text field) with
your prefilled answer visible and editable.

${REVIEW_HOWTO}

When the user has answered, write PRODUCT.md at the repo root from their answers (the format impeccable
\`init\` writes). Write nothing else except plans/brand-brief.html.
Return a one-line "oneLine" describing the product for a taste brief, and the closest "sector" (run
\`find ~/.claude/plugins -path '*taste-skill*' -name draw.mjs | head -1\` for the script, then
\`node <script> --list sectors\`; use args.sector when it was given and valid).`,
  {
    label: "brief:interview",
    phase: "Brief",
    schema: {
      type: "object",
      required: ["oneLine", "sector"],
      properties: { oneLine: { type: "string" }, sector: { type: "string" } },
      additionalProperties: false,
    },
  }
);
if (!brief) {
  log("Brief agent returned nothing — no PRODUCT.md to design from.");
  return { error: "brief agent returned nothing" };
}

// =============================================================================================
// Draw / critique / pick, up to two rounds. A second "None of these" ends the run.

const antiText = redo
  ? `\nANTI-REFERENCE: the current brand is described in DESIGN.md. Read it. Your comp must move AWAY from it
in palette, type, shape and voice. A comp that echoes it fails.\n`
  : "";

const DRAW_SCHEMA = {
  type: "object",
  required: ["html", "tokens", "screenshots"],
  properties: {
    html: { type: "string", description: "Repo-relative path of comp.html" },
    tokens: { type: "object", description: "The exact contents of tokens.json" },
    screenshots: { type: "array", items: { type: "string" } },
  },
  additionalProperties: true,
};

const drawPrompt = (d, extra) => `Draw brand comp ${d.id} for this product. You are one of up to three parallel lanes, each drawing a
different direction.

Read ${product} (the product) and your direction sheet ${d.sheet}. The sheet is your art direction:
follow it, do not blend in the other lanes' directions.
${antiText}${extra ?? ""}
FILE FENCE — write only under ${outDir}/${d.dirName ?? d.id}/ and nowhere else. If you think you need a file outside
it, STOP and report instead of editing it.

Skills: load \`taste-skill:design-taste-frontend\` and lead the landing hero with it; load
\`impeccable:impeccable\` and lead the dashboard and the primitives strip with it; load \`animate\` and
\`emil-design-eng\` to build the motion.

Write:
  · comp.html — ONE self-contained file (inline CSS and JS; fonts by Google Fonts link only) holding
    the landing hero, a dashboard screen, and a primitives strip (button, input, badge, table row,
    dialog, toast), with real motion and a light/dark toggle.
  · tokens.json — the TOKENS shape, exactly: { name, light, dark, fonts, radius, density, motion,
    voice, wordmark }. light and dark each hold the same keys as the custom properties in
    app/app.css (:root and .dark): read that file and match the key list, every colour an oklch()
    string. fonts is { sans: {family, href}, display: {family, href}|null, mono: {family, href}|null };
    density is compact|regular|airy; motion has ease-out, ease-in-out, duration-fast, duration-base,
    duration-slow; voice is 3 lines; wordmark is { text, family, weight, tracking, case: lower|upper|title }.
  · shots/desktop-light.png, desktop-dark.png, mobile-light.png, mobile-dark.png — real screenshots
    of comp.html (Playwright CLI, headless).
Do not write critique.md; the critics do.

${REPO_RULES}
Return the comp.html path, the tokens object you wrote, and the screenshot paths.`;

async function critique(comp) {
  const dir = comp.dir;
  // The taste loop edits comp.html (look, fix, look), so it runs alone first. The two critics
  // after it only read the finished pixels, so they run together.
  const taste = await agent(
    `Run the taste look-and-fix loop on the LANDING HERO of ${comp.html}.

Load \`taste-skill:design-taste-frontend\` and follow its references/critique.md loop: screenshot at
desktop and mobile, score, fix, repeat — AT MOST 3 rounds. You may edit only ${dir}/comp.html and
${dir}/shots/. Retake the four screenshots (desktop/mobile x light/dark) after your last edit.
A score under 7.5 after round 3 is reported exactly as scored. Never round up.
Return the final score (a number) and short notes on what changed and what still bites.`,
    {
      label: `critique:${comp.id}:taste`,
      phase: "Critique",
      schema: {
        type: "object",
        required: ["score", "notes"],
        properties: { score: { type: "number" }, notes: { type: "string" } },
        additionalProperties: false,
      },
    }
  );

  const [imp, motion] = await parallel([
    () =>
      agent(
        `Critique the DASHBOARD screen and the PRIMITIVES STRIP of ${comp.html}. Read-only: do not edit.

Load \`impeccable:impeccable\` and run its \`critique\` on the screenshots in ${dir}/shots/ (judge pixels,
not source). Report each issue with a P0-P3 severity.

Also check WCAG AA contrast for body text, muted text, primary-on-primary-foreground and borders
against ${dir}/tokens.json, in the light theme and the dark theme separately. Report contrastAA.light
and contrastAA.dark as booleans (true only if every pair passes AA).`,
        {
          label: `critique:${comp.id}:impeccable`,
          phase: "Critique",
          schema: {
            type: "object",
            required: ["findings", "contrastAA"],
            properties: {
              findings: FINDINGS,
              contrastAA: {
                type: "object",
                required: ["light", "dark"],
                properties: { light: { type: "boolean" }, dark: { type: "boolean" } },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        }
      ),
    () =>
      agent(
        `Review the motion in ${comp.html}. Read-only: do not edit.

Load the \`review-animations\` skill and run it. Check easing, duration, purpose, and that
prefers-reduced-motion collapses the motion. Return verdict PASS or FAIL with notes.`,
        {
          label: `critique:${comp.id}:motion`,
          phase: "Critique",
          schema: {
            type: "object",
            required: ["verdict", "notes"],
            properties: { verdict: { type: "string", enum: ["PASS", "FAIL"] }, notes: { type: "string" } },
            additionalProperties: false,
          },
        }
      ),
  ]);

  const result = {
    taste: taste ?? { score: 0, notes: "taste critic returned nothing" },
    impeccable: { findings: imp ? imp.findings : [{ severity: "P1", issue: "impeccable critic returned nothing" }] },
    motion: motion ?? { verdict: "FAIL", notes: "motion critic returned nothing" },
    contrastAA: imp ? imp.contrastAA : { light: false, dark: false },
  };

  await agent(
    `Write ${dir}/critique.md from this critique JSON. Plain markdown: one section each for Landing
(taste score, shown as scored), Dashboard and primitives (findings by severity), Motion, Contrast.
Write only that file.\n\n${JSON.stringify(result, null, 1)}`,
    { label: `critique:${comp.id}:notes`, phase: "Critique", effort: "low" }
  );
  return result;
}

async function drawAndCritique(d, extra, redrawn) {
  const drawn = await twice(
    (n) =>
      agent(drawPrompt(d, n > 1 ? `\nYour first attempt failed. First clear everything inside ${outDir}/${d.dirName ?? d.id}/ (your own directory only), then keep it smaller and finish.\n${extra ?? ""}` : extra), {
        label: `draw:${d.id}${redrawn ? ":redraw" : ""}`,
        phase: "Draw",
        schema: DRAW_SCHEMA,
      }),
    `comp ${d.id}`
  );
  if (!drawn) return { id: d.id, failed: "comp lane failed twice" };
  const comp = {
    id: d.id,
    dir: `${outDir}/${d.dirName ?? d.id}`,
    html: drawn.html,
    tokens: drawn.tokens,
    screenshots: drawn.screenshots ?? [],
    redrawn: !!redrawn,
  };
  const c = await critique(comp);
  return {
    ...comp,
    critique: { taste: c.taste, impeccable: c.impeccable, motion: c.motion },
    contrastAA: c.contrastAA,
  };
}

// One round: deal the direction sheets, draw and critique in parallel, check sameness, redraw once.
async function proposeRound(firstId, avoidDrawIds, sector, oneLine) {
  phase("Draw");
  const deal = await agent(
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
      schema: {
        type: "object",
        required: ["drawIds", "directions"],
        properties: {
          drawIds: { type: "array", items: { type: "string" } },
          directions: {
            type: "array",
            items: {
              type: "object",
              required: ['id', 'sheet'],
              properties: { id: { type: "number" }, sheet: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    }
  );
  const directions = deal ? deal.directions.slice(0, 3) : [];
  if (!directions.length) return { error: "draw.mjs produced no directions" };
  log(`Propose: ${directions.length} comp lane(s) in parallel${redo ? ", moving away from DESIGN.md" : ""}`);

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
    const sameness = await agent(
      `Do any of these brand comps look alike? Judge from the screenshots (open them) and the tokens: palette
hue family, type pairing, shape language, density, mood. Read-only.

${comps.map((c) => `--- comp ${c.id} ---\nscreenshots: ${c.screenshots.join(", ")}\ntokens: ${JSON.stringify({ name: c.tokens && c.tokens.name, fonts: c.tokens && c.tokens.fonts, radius: c.tokens && c.tokens.radius, density: c.tokens && c.tokens.density, primary: c.tokens && c.tokens.light && c.tokens.light.primary })}`).join("\n")}

Return the pairs of comp ids a stranger would call the same brand. Empty list if none.`,
      {
        label: "critique:sameness",
        phase: "Critique",
        schema: {
          type: "object",
          required: ["pairs"],
          properties: { pairs: { type: "array", items: { type: "array", items: { type: "number" } } } },
          additionalProperties: false,
        },
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

async function pickRound(round, comps, failed, similar, again) {
  phase("Pick");
  const file = round === 1 ? "plans/brand-pick.html" : "plans/brand-pick-2.html";
  const askHome = typeof input.rebuildHome !== "boolean";
  const pick = await agent(
    `Ask the user to pick a brand. Write ${file}, tier small.${again ? " (The first poll ended without an answer: reopen the same file and poll again.)" : ""}

One card per comp: name, comp.html inlined in an <iframe srcdoc> (or its markup, if small), the four
screenshots (embed them as data URIs so the file is self-contained), the taste score, the impeccable
findings, the motion verdict, the AA result. Print scores as returned, even under 7.5.

Comps:
${comps.map((c) => `--- comp ${c.id}: ${c.tokens && c.tokens.name} ---\nhtml: ${c.html}\nscreenshots: ${c.screenshots.join(", ")}\nredrawn for sameness: ${c.redrawn}\ncritique: ${JSON.stringify(c.critique)}\ncontrastAA: ${JSON.stringify(c.contrastAA)}`).join("\n\n")}

Also print: a note on each redrawn comp; "Lane N failed: <reason>" for each of ${JSON.stringify(failed)};
a line for each pair in ${JSON.stringify(similar)} that the critics judged alike.

Decision 1, pick: one radio per surviving comp plus "None of these — draw three more". Pre-check none.
Say in one sentence which comp you would pick and why.
${
  askHome
    ? 'Decision 2, rebuild home?: one radio, "Yes (recommended)" / "No". Say what yes costs: one more lane, and app/routes/home.tsx changes.'
    : `No second decision: rebuild home is already set to ${input.rebuildHome} by the caller.`
}

${REVIEW_HOWTO}

Return decision "pick" with the chosen comp id, "none" (pick null) only if the user chose "None of these",
or "unanswered" if the review ended without a choice. Also return the home answer as a boolean (${askHome ? "from decision 2" : `${input.rebuildHome}`}), and for every comp that was NOT
chosen a one-line "why" built from the critiques and anything the user wrote; do not invent a reason.`,
    {
      label: `pick:round-${round}`,
      phase: "Pick",
      schema: {
        type: "object",
        required: ["decision", "pick", "rebuildHome", "rejected"],
        properties: {
          decision: { type: "string", enum: ["pick", "none", "unanswered"] },
          pick: { type: ["number", "null"] },
          rebuildHome: { type: "boolean" },
          rejected: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "why"],
              properties: { id: { type: "number" }, why: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    }
  );
  return pick;
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
  let p = await pickRound(round, r.comps, r.failed, r.similar, false);
  // An unanswered review, or an id that matches no surviving comp, is not "None of these".
  const valid = (x) => x && (x.decision === "none" || (x.decision === "pick" && r.comps.some((c) => c.id === x.pick)));
  if (!valid(p)) {
    log("Pick unanswered or unknown — polling once more, not redrawing");
    p = await pickRound(round, r.comps, r.failed, r.similar, true);
  }
  if (!valid(p)) {
    log("Still no usable pick — stopping rather than guessing a brand.");
    return { error: "no usable pick from the user", comps: r.comps };
  }
  const chosen = p.decision === "pick" ? r.comps.find((c) => c.id === p.pick) : null;
  if (chosen) {
    winner = chosen;
    rebuildHome = typeof input.rebuildHome === "boolean" ? input.rebuildHome : p.rebuildHome;
    rejectedAll = [...rejectedAll, ...p.rejected.filter((x) => x.id !== chosen.id)];
    break;
  }
  rejectedAll = [...rejectedAll, ...r.comps.map((c) => ({ id: c.id, why: (p.rejected.find((x) => x.id === c.id) || {}).why || "rejected with the round" }))];
  avoid = r.drawIds;
  if (round === 2) {
    log("The user rejected both sets. Not drawing a third time on my own.");
    return {
      error: "both sets of comps rejected — ask the user what they want to see",
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

const ui = (names) => names.map((n) => `app/components/ui/${n}.tsx`);

// Hardcoded fences. The four primitive families cover all 55 files in app/components/ui once.
const CONTRACT_FENCE = ["app/app.css", "app/root.tsx"];
const BUILD_LANES = [
  {
    name: "primitives:actions-forms",
    owns: ui(["button", "button-group", "toggle", "toggle-group", "input", "input-group", "input-otp", "textarea", "label", "field", "form", "checkbox", "radio-group", "switch", "slider", "select", "native-select", "combobox", "calendar", "kbd"]),
  },
  {
    name: "primitives:overlays-feedback",
    owns: ui(["dialog", "alert-dialog", "sheet", "drawer", "popover", "hover-card", "tooltip", "dropdown-menu", "context-menu", "menubar", "command", "alert", "sonner", "progress", "skeleton", "spinner", "empty"]),
  },
  {
    name: "primitives:layout-nav",
    owns: ui(["accordion", "collapsible", "tabs", "navigation-menu", "breadcrumb", "pagination", "sidebar", "separator", "scroll-area", "resizable", "aspect-ratio", "card"]),
  },
  {
    name: "primitives:data-display",
    owns: ui(["table", "chart", "avatar", "badge", "item", "carousel"]),
  },
  {
    name: "shared",
    owns: [
      "app/components/feature-card.tsx",
      "app/components/file-upload.tsx",
      "app/components/language-switcher.tsx",
      "app/components/stack-badge.tsx",
      "app/components/theme-toggle.tsx",
      "app/components/brand/**",
    ],
  },
  ...(rebuildHome ? [{ name: "home", owns: ["app/routes/home.tsx"] }] : []),
];
const ALL_FENCES = [...CONTRACT_FENCE, ...BUILD_LANES.flatMap((l) => l.owns)];

// Paths no lane owns but that may legitimately change while the run is live.
const IGNORED_PREFIXES = [".brain/", "plans/", ".react-router/", "node_modules/", ".wrangler/", "test-results/", "playwright-report/"];

const inFence = (path, fence) =>
  fence.some((f) => (f.endsWith("/**") ? path.startsWith(f.slice(0, -2)) : path === f));
const ignored = (path) => IGNORED_PREFIXES.some((p) => path.startsWith(p));
const ownerOf = (path) => BUILD_LANES.find((l) => inFence(path, l.owns)) || null;

// Files the run itself writes outside every fence: the brief, the brand docs, the plans.
const allowed = (path) => path === "PRODUCT.md" || path === "DESIGN.md" || path.startsWith("DESIGN.") || /^plans\/brand-[^/]*\.html$/.test(path);
// Paths that were already dirty before the contract lane ran; filled by the snapshot below.
const preDirty = new Set();
const exempt = (path) => ignored(path) || allowed(path) || preDirty.has(path);

const tokensJson = JSON.stringify(tokens, null, 1);
const DESIGN_BRIEF = `BRAND: the winner is comp ${winner.id} ("${tokens.name ?? "unnamed"}"), at ${compDir} — comp.html shows it
drawn, tokens.json holds the values. Product context is in ${product}.
TOKENS:
${tokensJson}
The comps that lost, so you do not drift toward them:
${rejected.length ? rejected.map((r) => `  · comp ${r.id}: ${r.why}`).join("\n") : "  (none recorded)"}`;

const FILES_SCHEMA = {
  type: "object",
  required: ["files", "report"],
  properties: {
    files: { type: "array", items: { type: "string" }, description: "Every repo-relative file you changed" },
    reverted: { type: "array", items: { type: "string" }, description: "Out-of-fence paths you restored (fence repair only)" },
    report: { type: "string", description: "One line per file, plus anything you could not do" },
  },
  additionalProperties: false,
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["verdict", "findings", "evidence"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "FAIL"] },
    findings: FINDINGS,
    evidence: { type: "string", description: "Screenshot paths or verbatim command output tails" },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------------------------
phase("Contract");

// Snapshot what is dirty before any lane writes, so every later diff can subtract it. PRODUCT.md
// (written by Brief, untracked) lands here, and nothing may revert or delete it.
const snap = await agent(
  `List every path that differs from HEAD right now, repo-relative, including untracked files: run
\`git status --porcelain\` (for a rename, give the new path). Read-only; change nothing.`,
  {
    label: "contract:snapshot",
    phase: "Contract",
    effort: "low",
    schema: {
      type: "object",
      required: ["paths"],
      properties: { paths: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    },
  }
);
(snap ? snap.paths : []).forEach((p) => preDirty.add(p));
if (!snap) log("WARNING: pre-build snapshot returned nothing — stray-file detection may over-report");

// The one sequential step: every build lane reads these tokens, so they land first.
const contract = await agent(
  `Apply the chosen brand's token layer. You are the CONTRACT lane; the build lanes start after you finish.

${DESIGN_BRIEF}

FILE FENCE — you own ${CONTRACT_FENCE.join(" and ")} and nothing else. If you think you need another
file, STOP and report it.

Do:
  1. app/app.css — set every custom property in :root and .dark from the tokens (same key list; read
     the file and match it, adding none and dropping none unless the tokens differ). Add the motion
     tokens as --ease-out, --ease-in-out, --duration-fast, --duration-base, --duration-slow, and a
     @media (prefers-reduced-motion: reduce) block that collapses the durations to 0ms. Set --radius,
     and the font families (--font-sans and, if present, display and mono).
  2. app/root.tsx — add the font <link> tags for tokens.fonts hrefs (preconnect plus stylesheet).
  3. AA check: for each foreground/background pair (foreground/background, card, popover, primary,
     secondary, muted, accent, sidebar variants, destructive) in light AND dark, compute WCAG contrast.
     A pair under 4.5:1 for text gets its lightness adjusted, keeping hue and chroma. List every
     change you made.
Load \`impeccable:impeccable\` for the colour work. The tokens in app/app.css beat every skill.

${REPO_RULES}
Return the files you changed and a report that lists each contrast adjustment (token, before, after).`,
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

log(`Build: ${BUILD_LANES.length} lanes in parallel — ${BUILD_LANES.map((l) => l.name).join(", ")}`);

const PRIMITIVE_RULE = `PRIMITIVE RULE: edit the files in place through their cva variants and the semantic tokens. Keep every
export, prop and variant name, so no call site changes. No raw hex, no arbitrary Tailwind values.`;

const laneTask = (lane) =>
  lane.name.startsWith("primitives")
    ? PRIMITIVE_RULE
    : lane.name === "shared"
      ? "Also add a typeset wordmark under app/components/brand/ from tokens.wordmark (text, family, weight, tracking, case). Keep every export and prop of the existing components."
      : "Rebuild the home page in the chosen brand, using tokens.voice for copy tone. Keep its i18n keys and routes working.";

const lanePrompt = (lane, extra) => `Lane: ${lane.name}. You are one of ${BUILD_LANES.length} lanes building the chosen brand in parallel.

${DESIGN_BRIEF}

The token layer is already in app/app.css (and the font link in app/root.tsx). Read them; do not edit them.

FILE FENCE — you own these paths and only these paths:
${lane.owns.map((p) => `  · ${p}`).join("\n")}
Editing anything outside them collides with a concurrent lane. If your task appears to need a file you
do not own, STOP and report it instead of editing it.

${laneTask(lane)}

Skills: ${lane.name === "home" ? "load `taste-skill:design-taste-frontend` as lead (public page), and" : "load `impeccable:impeccable` as lead, and"} \`animate\` + \`emil-design-eng\` for anything that moves. Motion uses the --ease-* and --duration-* tokens.
${extra ?? ""}
${REPO_RULES}
Return the files you changed and a one-line-per-file report.`;

const built = await parallel(
  BUILD_LANES.map((lane) => () =>
    agent(lanePrompt(lane), { label: `build:${lane.name}`, phase: "Build", agentType: "ui-builder", schema: FILES_SCHEMA })
  )
);

const lanes = BUILD_LANES.map((lane, i) => ({
  name: lane.name,
  owns: lane.owns,
  files: built[i] ? built[i].files : [],
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
  const diff = await agent(
    `List every file that differs from HEAD in the working tree, repo-relative, including untracked
files: run \`git status --porcelain\` and \`git diff --name-only HEAD\`. Read-only; change nothing.
Return the paths.`,
    {
      label: "build:fence-diff",
      phase: phaseName,
      effort: "low",
      schema: {
        type: "object",
        required: ["paths"],
        properties: { paths: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    }
  );
  if (!diff) log("WARNING: git diff fence check returned nothing — earlier violations stay, only lane self-reports are added");
  const current = new Set(diff ? diff.paths : []);
  const next = [];
  for (const v of fenceViolations) {
    const outsideAll = !inFence(v.path, ALL_FENCES);
    const clean = outsideAll
      ? !!diff && !current.has(v.path)
      : reports.some((r) => r.name === v.lane && (r.reverted || []).includes(v.path));
    if (!clean) next.push(v);
  }
  const known = () => new Set(next.map((v) => v.path));
  for (const r of reports) {
    const reverted = r.reverted || [];
    for (const f of r.files) {
      if (!inFence(f, r.owns) && !exempt(f) && !reverted.includes(f) && !known().has(f)) next.push({ lane: r.name, path: f });
    }
  }
  for (const p of current) {
    if (!inFence(p, ALL_FENCES) && !exempt(p) && !known().has(p)) next.push({ lane: "unattributed", path: p });
  }
  return next;
}

fenceViolations = await fenceCheck(
  [...lanes, { name: "contract:tokens", owns: CONTRACT_FENCE, files: contract.files }],
  "Build"
);
fenceViolations.forEach((v) => log(`P0 FENCE VIOLATION: ${v.lane} touched ${v.path}`));

// ---------------------------------------------------------------------------------------------
phase("Check");

// Writers are done and the fence is checked. Everything below only reads, needs the finished tree,
// and runs at once. Each browser lane owns its own port.
const SURFACES = `the kitchen-sink route, the dashboard, and the admin users page — at desktop (1440) and mobile
(390) widths, in light and dark. Find the kitchen-sink route under app/routes/ (read only for its URL).`;

const FIND_NOTE = "Name the repo-relative file each fix belongs in, in the finding's file field.";

const CHECKS = [
  {
    name: "impeccable critique",
    run: () =>
      agent(
        `Critique the rendered brand. Read-only: fix nothing.

${DESIGN_BRIEF}

Drive ${SURFACES} Dev server: \`CI=1 bun run dev --port 5281\` (yours alone; stop it when done).
Screenshots go under ${outDir}/check/. Load \`impeccable:impeccable\` and run \`critique\` on
them. Judge pixels. Does it match the chosen comp (${compDir}/shots/)? Report every issue P0-P3. ${FIND_NOTE}`,
        { label: "check:impeccable-critique", phase: "Check", schema: VERDICT_SCHEMA }
      ),
  },
  ...(rebuildHome
    ? [
        {
          name: "taste critique (home)",
          run: () =>
            agent(
              `Critique the rebuilt HOME page. Read-only: fix nothing.

Dev server: \`CI=1 bun run dev --port 5282\` (yours alone). Screenshot / at desktop and mobile, light
and dark, under ${outDir}/check/. Load \`taste-skill:design-taste-frontend\` and run its
references/critique.md loop, at most 3 rounds, scoring only (no fixing). A score under 7.5 is reported
as scored and is a P1; never round up. Put the score and the last critique in evidence.`,
              { label: "check:taste-critique", phase: "Check", schema: VERDICT_SCHEMA }
            ),
        },
      ]
    : []),
  {
    name: "review-animations",
    run: () =>
      agent(
        `Review the motion of the rebuilt brand. Read-only: fix nothing.

Dev server: \`CI=1 bun run dev --port 5283\` (yours alone). Load the \`review-animations\` skill and
run it over the primitives that move (dialog, sheet, dropdown-menu, tabs, accordion, sonner, button
press states). Check that the durations and easings come from the --duration-* / --ease-* tokens and
that prefers-reduced-motion collapses them. ${FIND_NOTE}`,
        { label: "check:review-animations", phase: "Check", schema: VERDICT_SCHEMA }
      ),
  },
  {
    name: "brain verify gates",
    run: () =>
      agent(
        `Run the declared gates on the working tree. Run \`brain verify\` (typecheck, test, non-negotiables,
harness, build, e2e; \`brain verify list\` shows them). Typecheck must pass with NO call-site edits
outside app/components/ — if it fails in a route, that is a P1 naming the export that changed.
Report each gate pass/fail with verbatim output tails. Do not fix anything. For anything needing a
dev server use CI=1 and a free port of your own. ${FIND_NOTE}`,
        { label: "check:gates", phase: "Check", schema: VERDICT_SCHEMA }
      ),
  },
  {
    name: "feature-verifier walk",
    run: () =>
      agent(
        `Prove the branded app still works: walk sign-up, the dashboard, and admin users through the LIVE
app, golden path each, with the Playwright CLI. Dev server: \`CI=1 bun run dev --port 5284\` (yours
alone). Screenshot each step under ${outDir}/walk/. Do NOT run \`brain verifications add\` — the Ship
phase records it. Return PASS or FAIL, put the screenshot paths in evidence. ${FIND_NOTE}`,
        { label: "check:browser-walk", phase: "Check", agentType: "feature-verifier", schema: VERDICT_SCHEMA }
      ),
  },
];

const results = {}; // check name -> latest result (null if the agent returned nothing)
// The gates run first and alone: they build and run e2e, and several dev servers on one local D1
// make flaky results. The critiques and the walk need the same tree and run together after them.
async function runChecks(defs) {
  const gates = defs.filter((c) => c.name === "brain verify gates");
  const rest = defs.filter((c) => c.name !== "brain verify gates");
  if (gates.length) results[gates[0].name] = await gates[0].run();
  const out = await parallel(rest.map((c) => () => c.run()));
  rest.forEach((c, i) => (results[c.name] = out[i]));
}
await runChecks(CHECKS);

const isBlocking = (f) => f.severity === "P0" || f.severity === "P1";
const checkFailed = (name) => {
  const r = results[name];
  return !r || r.verdict !== "PASS" || r.findings.some(isBlocking);
};
const openFindings = () =>
  CHECKS.flatMap((c) => {
    const r = results[c.name];
    if (!r) return [{ severity: "P1", source: c.name, issue: "check returned nothing" }];
    const blocking = r.findings.filter(isBlocking).map((f) => ({ severity: f.severity, source: c.name, issue: f.issue, file: f.file }));
    // A FAIL with no P0/P1 finding (a red gate reported as findings: []) must still block.
    if (r.verdict !== "PASS" && !blocking.length) {
      blocking.push({ severity: "P1", source: c.name, issue: `verdict ${r.verdict} with no blocking finding. Evidence: ${String(r.evidence).slice(0, 400)}` });
    }
    return blocking;
  });
const extraBlocking = []; // findings the code itself raises (for example a missing DESIGN.md)
const openBlocking = () => [
  ...fenceViolations.map((v) => ({ severity: "P0", source: `fence:${v.lane}`, issue: `edited ${v.path}, outside its fence`, file: v.path })),
  ...openFindings(),
  ...extraBlocking,
];

// ---- Escalation: whatever is still open goes to the user, never rounded up --------------------
const escalations = [];
async function escalate(items, why, tag) {
  log(`${items.length} item(s) ${why} — escalating to the user`);
  const answer =
    (await agent(
      `Escalate to the user. Write plans/brand-escalation.html, tier small.

These findings ${why}. Show each one as scored, with its severity, source and file, and the relevant
screenshots (desktop and mobile) from ${outDir}/check/ embedded as data URIs. Do not round up, do not
call anything fine.

${JSON.stringify(items, null, 1)}

One decision card: "Ship with these open (I accept the risk)" or "Stop here (I will decide what to fix)".
Pre-check neither. Add a free-text field for the user's reasoning.

${REVIEW_HOWTO}

Return the choice as accept or stop, and the user's notes verbatim. If the review ended without a
choice, return stop.`,
      {
        label: `fix:escalation:${tag}`,
        phase: tag === "post-close" ? "Close" : "Fix",
        schema: {
          type: "object",
          required: ["decision", "notes"],
          properties: { decision: { type: "string", enum: ["accept", "stop"] }, notes: { type: "string" } },
          additionalProperties: false,
        },
      }
    )) ?? { decision: "stop", notes: "escalation agent returned nothing" };
  escalations.push({ ...answer, about: items.map((i) => `${i.source}: ${i.issue}`) });
  return answer;
}
const accepted = () => escalations.length > 0 && escalations.every((e) => e.decision === "accept");

// ---------------------------------------------------------------------------------------------
phase("Fix");

const offenderOf = (name) =>
  name === "contract:tokens" ? { name, owns: CONTRACT_FENCE } : BUILD_LANES.find((l) => l.name === name) || null;

const repairPrompt = (name, owns, vs) => `Lane: ${name}. FENCE REPAIR. You edited paths outside your fence:
${vs.map((v) => `  · ${v.path}`).join("\n")}
Your fence:
${owns.map((p) => `  · ${p}`).join("\n")}
Undo ONLY your own edit to each path. If the path sits outside every lane's fence, restore it with
\`git checkout HEAD -- <path>\`. If it sits inside another lane's fence, reverse just the lines you
changed by hand: never git checkout a file another lane owns, it holds their work. Never delete an
untracked file outside app/. Never touch these paths, which were dirty before the build:
${[...preDirty].join(", ") || "(none)"}.
Change nothing else. Return the files you changed, the paths you actually reverted in \`reverted\`, and a report.`;

// Up to two rounds. First the OFFENDING lane repairs its own out-of-fence edits, alone (plan error
// table: "P0; rerun that lane alone"); then the owning lane (by fence) fixes each finding; then only
// the failing checks run again. Anything that survives goes to the user.
for (let round = 1; round <= 2 && openBlocking().length; round++) {
  const open = openBlocking();
  log(`Fix round ${round}: ${open.length} open P0/P1`);

  // A. Fence violations. The offender repairs first, so that no repair overlaps a fix lane.
  const byOffender = new Map();
  const strays = [];
  for (const v of fenceViolations) {
    const lane = offenderOf(v.lane);
    if (lane) byOffender.set(lane.name, { lane, vs: [...(byOffender.get(lane.name)?.vs || []), v] });
    else strays.push(v);
  }
  const repairs = await parallel(
    [...byOffender.values()].map(({ lane, vs }) => () =>
      agent(repairPrompt(lane.name, lane.owns, vs), {
        label: `fix:${round}:repair:${lane.name}`,
        phase: "Fix",
        agentType: "ui-builder",
        schema: FILES_SCHEMA,
      }).then((r) => ({ name: lane.name, owns: lane.owns, files: r ? r.files : [], reverted: r ? r.reverted ?? [] : [], report: r ? r.report : "repair lane returned nothing" }))
    )
  );
  if (strays.length) {
    const r = await agent(
      `Restore these files, which no lane may edit:
${strays.map((v) => `  · ${v.path} (touched by ${v.lane})`).join("\n")}
For a tracked file: \`git checkout HEAD -- <path>\`. For an untracked file: delete it ONLY if it is under app/;
anywhere else leave it and say so. Never touch these paths, which were dirty before the build:
${[...preDirty].join(", ") || "(none)"}.
Touch nothing else. Return the files you changed, the paths you restored or deleted in \`reverted\`, and a report.`,
      { label: `fix:${round}:revert-strays`, phase: "Fix", effort: "low", schema: FILES_SCHEMA }
    );
    if (!r) log("WARNING: revert agent returned nothing");
    repairs.push({ name: "revert-strays", owns: [], files: r ? r.files : [], reverted: r ? r.reverted ?? [] : [], report: r ? r.report : "revert agent returned nothing" });
  }

  // B. Findings. Group by owning lane; findings with no resolvable owner go to a solo pass afterwards.
  const byLane = new Map();
  const orphans = [];
  for (const f of open.filter((x) => !x.source.startsWith("fence:"))) {
    const owner = f.file ? ownerOf(f.file) : null;
    if (owner) byLane.set(owner.name, [...(byLane.get(owner.name) || []), f]);
    else orphans.push(f);
  }
  const fixed = await parallel(
    [...byLane.entries()].map(([name, fs]) => () => {
      const lane = BUILD_LANES.find((l) => l.name === name);
      return agent(
        lanePrompt(
          lane,
          `\nFIX ROUND ${round}. This lane already built. Fix ONLY these open findings, inside your fence, and change nothing else:
${fs.map((f) => `  · [${f.severity}] ${f.source}: ${f.issue}${f.file ? ` (${f.file})` : ""}`).join("\n")}\n`
        ),
        { label: `fix:${round}:${name}`, phase: "Fix", agentType: "ui-builder", schema: FILES_SCHEMA }
      ).then((r) => ({ name, owns: lane.owns, files: r ? r.files : [], reverted: [], report: r ? r.report : "fix lane returned nothing" }));
    })
  );
  // Findings no fence owns go to one solo pass, after the owned lanes, so no two writers overlap.
  if (orphans.length) {
    const solo = await agent(
      `FIX ROUND ${round}, solo pass. These open findings name no file inside any lane's fence:
${orphans.map((f) => `  · [${f.severity}] ${f.source}: ${f.issue}${f.file ? ` (${f.file})` : ""}`).join("\n")}

${DESIGN_BRIEF}

FILE FENCE — you may edit only these paths:
${ALL_FENCES.map((p) => `  · ${p}`).join("\n")}
If a finding needs anything else, STOP and report it. Keep every export, prop and variant name.
${REPO_RULES}
Return the files you changed and a report.`,
      { label: `fix:${round}:solo`, phase: "Fix", agentType: "ui-builder", schema: FILES_SCHEMA }
    );
    fixed.push({ name: "fix:solo", owns: ALL_FENCES, files: solo ? solo.files : [], reverted: [], report: solo ? solo.report : "solo fix returned nothing" });
  }
  const roundReports = [...repairs, ...fixed].filter(Boolean);
  lanes.push(...roundReports.map((r) => ({ ...r, name: `${r.name} (fix ${round})` })));

  fenceViolations = await fenceCheck(roundReports, "Fix");
  fenceViolations.forEach((v) => log(`P0 FENCE VIOLATION still open: ${v.lane} touched ${v.path}`));

  const failing = CHECKS.filter((c) => checkFailed(c.name));
  if (failing.length) await runChecks(failing);
}

const stillOpen = openBlocking();
if (stillOpen.length) await escalate(stillOpen, "survived two fix rounds", "post-fix");
let mayShip = !stillOpen.length || accepted();

// ---------------------------------------------------------------------------------------------
phase("Close");

// Polish is a finish pass, not a fix round; skip it when something is still on fire.
let polishReport = "skipped: open P0/P1 and the user did not accept them";
if (mayShip) {
  const polish = await agent(
    `Finish pass on the branded app. Load \`impeccable:impeccable\` and run \`polish\` (then \`audit\`
if time allows) on the kitchen-sink route, dashboard and admin users.

FILE FENCE — you may edit only these paths:
${ALL_FENCES.map((p) => `  · ${p}`).join("\n")}
Anything outside them: STOP and report it, do not edit. Keep every export, prop and variant name.

${REPO_RULES}
Return the files you changed and a report.`,
    { label: "close:polish", phase: "Close", agentType: "ui-builder", schema: FILES_SCHEMA }
  );
  polishReport = polish ? polish.report : "polish lane returned nothing";

  // DESIGN.md comes from the shipped artifact, so it must follow polish.
  const doc = await agent(
    `Write DESIGN.md at the repo root from the SHIPPED app, not from intentions. Read app/app.css,
app/root.tsx, app/components/ui/ and app/components/brand/, and the chosen comp at ${compDir}.

${DESIGN_BRIEF}

Record: colour tokens (light and dark) with their roles, type scale and pairings, radius and density,
motion tokens and the reduced-motion rule, the wordmark, the voice lines, component conventions, and
this contrast log from the contract lane:
${contract.report}
Write only DESIGN.md (and its sidecar if your instructions call for one). When done, confirm with
\`ls -l DESIGN.md\`, then return written=true and every file you wrote.`,
    {
      label: "close:design-md",
      phase: "Close",
      agentType: "impeccable-documenter",
      schema: {
        type: "object",
        required: ["written", "files"],
        properties: { written: { type: "boolean" }, files: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    }
  );
  if (!doc || !doc.written || !doc.files.includes("DESIGN.md")) {
    extraBlocking.push({ severity: "P1", source: "close:design-md", issue: "the documenter did not confirm DESIGN.md was written", file: "DESIGN.md" });
    mayShip = false;
  }

  // Polish and the documenter ran after the Fix-phase check, so check the whole tree again.
  const before = new Set(fenceViolations.map((v) => v.path));
  fenceViolations = await fenceCheck(
    [{ name: "close:polish", owns: ALL_FENCES, files: polish ? polish.files : [] }, { name: "close:design-md", owns: [], files: [] }],
    "Close"
  );
  const fresh = fenceViolations.filter((v) => !before.has(v.path));
  fresh.forEach((v) => log(`P0 FENCE VIOLATION after Close: ${v.lane} touched ${v.path}`));
  if (fresh.length) {
    await escalate(
      fresh.map((v) => ({ severity: "P0", source: `fence:${v.lane}`, issue: `edited ${v.path}, outside its fence`, file: v.path })),
      "appeared after polish and DESIGN.md",
      "post-close"
    );
    if (!accepted()) mayShip = false;
  }
}

const finalBlocking = openBlocking();
const synthesis = await agent(
  `Synthesise the outcome of the /brand-init run. Do not edit any files — this is a report.

Chosen brand: comp ${winner.id} ("${tokens.name ?? "unnamed"}"). Rebuilt home: ${rebuildHome ? "yes" : "no"}.

Contract lane report:
${contract.report}

Lane reports (build and fix):
${lanes.map((l) => `--- ${l.name} ---\n${l.report}`).join("\n\n")}

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
   shifts the brand, an export that had to change), and the escalation answers if there were any. Never
   decide these yourself.

Be blunt about what is unfinished.`,
  { label: "close:synthesis", phase: "Close", effort: "high" }
);

// ---------------------------------------------------------------------------------------------
phase("Ship");

// One shape on every path: { shipped, reason?, gatesGreen?, verificationRecorded?, commit?, pr? }.
let ship = { shipped: false, reason: "open P0/P1 or a missing DESIGN.md, and the user did not accept them" };
if (mayShip) {
  const lastCritique = results["impeccable critique"] ? JSON.stringify(results["impeccable critique"], null, 1) : "(the impeccable critique returned nothing)";
  const walk = results["feature-verifier walk"];
  const motionRes = results["review-animations"];
  const STAGE = [...ALL_FENCES, "PRODUCT.md", "DESIGN.md", "DESIGN.* (its sidecar, if the documenter wrote one)", "plans/brand-pick*.html"];
  const shipped = await agent(
    `Ship the brand. You own the brain writes, the commit and the PR for this run.

${DESIGN_BRIEF}

Open findings the user explicitly accepted in an escalation review: ${accepted() ? "YES — " + JSON.stringify(escalations) : "no"}.

Steps, in order:
  1. \`brain verify\` (every gate, including build and e2e). Also \`bun run typecheck\` and confirm no
     call site outside app/components/ changed.
  2. IF ANY GATE IS RED${accepted() ? "" : ": STOP. Change nothing, write nothing to the brain, commit nothing, push nothing, open no PR. Return shipped=false, gatesGreen=false and the failing gate in reason"}.${
      accepted()
        ? " The user accepted open findings, so you may continue: skip the verification and the ship below, and say in the PR which gate failed."
        : ""
    }
     IF every gate is green:
     · \`brain verifications add brand-init --verdict PASS --body-from <file> --shot <png>::"<caption>"\`
       (screenshots from ${outDir}/check/ and ${outDir}/walk/). The body pastes the last impeccable
       critique WHOLE (AGENTS.md rule), then the review-animations verdict, then the feature-verifier
       walk, then the fix rounds that ran. If a P0/P1 was accepted by the user, say so and write the
       verdict as the facts are; do not write PASS over an unresolved P0/P1 — use FAIL or PARTIAL.
       Last impeccable critique:
${lastCritique}
       review-animations: ${motionRes ? JSON.stringify(motionRes) : "returned nothing"}
       walk: ${walk ? JSON.stringify(walk) : "returned nothing"}
       Escalation answers: ${escalations.length ? JSON.stringify(escalations) : "none"}
     · \`brain features ship brand-init --evidence "<one line>"\` only if that verification is a PASS.
  3. \`brain docs set codebase design-system\`: the winner and why (cite its taste score and
     critique), then the comps that lost and why:
${rejected.length ? rejected.map((r) => `       · comp ${r.id}: ${r.why}`).join("\n") : "       · (none)"}
  4. \`brain progress add --summary "..." --next "..."\`.
  5. Extend scripts/seed-preview.ts only if the run changed seeded data (it should not); stage it only then.
  6. ONE commit, one PR. Stage EXPLICIT paths with \`git add -- <paths>\`, never a wholesale \`git add app/\` or \`-A\`:
${STAGE.map((p) => `       · ${p}`).join("\n")}
     Do NOT stage plans/brand-brief.html, plans/brand-escalation.html, anything under .brain/, or draw
     files. Check \`git status --short\` afterwards: anything modified and unstaged that is not one of
     those is a surprise, so name it in your note. Commit message:
     \`feat(brand): ${tokens.name ?? "new"} brand — tokens, primitives, DESIGN.md\`, ending with the line:
     Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
     Push the branch and open the PR with the \`engineering-toolkit:pr-format\` skill's layout: the pick
     screenshots (desktop and mobile, light and dark) and the final critique summary in the body, the
     rejected comps and why, and any open finding named plainly. End the PR body with:
     🤖 Generated with [Claude Code](https://claude.com/claude-code)
  7. DO NOT MERGE.

Synthesis to ground your account:
${synthesis}

Return shipped (true only if a commit and a PR exist), gatesGreen, verificationRecorded, the commit sha,
the PR url, and a reason when shipped is false or anything went wrong.`,
    {
      label: "ship:record-commit-pr",
      phase: "Ship",
      schema: {
        type: "object",
        required: ["shipped"],
        properties: {
          shipped: { type: "boolean" },
          reason: { type: "string" },
          gatesGreen: { type: "boolean" },
          verificationRecorded: { type: "boolean" },
          commit: { type: "string" },
          pr: { type: "string" },
        },
        additionalProperties: false,
      },
    }
  );
  ship = shipped ?? { shipped: false, reason: "ship agent returned nothing" };
}

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
  designMd: mayShip ? "DESIGN.md" : null,
  synthesis,
  ship,
};
