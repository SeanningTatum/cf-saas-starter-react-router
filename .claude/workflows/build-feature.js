export const meta = {
  name: "build-feature",
  description:
    "Build a feature end to end with the harness sub-agents fanned out in parallel — orient, contract, parallel build lanes on disjoint files, parallel verification, synthesis",
  whenToUse:
    "A feature with more than one layer (schema/repo/procedure/UI) where the lanes can proceed against a fixed contract. Overkill for a one-file change.",
  phases: [
    { title: "Orient", detail: "reading list + nearest existing feature + design prep, in parallel" },
    { title: "Contract", detail: "architect fixes the interface every lane builds against" },
    { title: "Build", detail: "lanes own disjoint files and run concurrently" },
    { title: "Verify", detail: "gates, non-negotiables, spans, design critique, browser walk" },
    { title: "Close", detail: "synthesis + what still needs a human" },
  ],
};

/**
 * WHY THIS EXISTS
 *   Sequentially, a feature is: read the brain → design → schema → repo → procedure → UI → tests →
 *   verify. Most of that ordering is a *compile* dependency, not an *information* dependency. Once
 *   the interface is fixed, the server lane and the UI lane need nothing from each other, and every
 *   verification lane needs only the finished tree. So the only truly sequential steps are: fix the
 *   contract, then converge.
 *
 * THE RULE THAT KEEPS IT SAFE
 *   Parallel writers must own **disjoint paths**. The Contract phase assigns file ownership per lane
 *   and every lane prompt repeats its own fence. Two agents editing one file is the failure mode
 *   this design trades away, so it is stated, not assumed.
 *
 * args: a string (the feature description) or
 *       { feature: string, slug?: string, ui?: boolean, e2e?: boolean }
 */
const input = typeof args === "string" ? { feature: args } : (args ?? {});
const feature = input.feature ?? "(no description given)";
const slug = input.slug ?? "";
const hasUi = input.ui !== false; // assume user-visible unless told otherwise
const wantsE2e = input.e2e !== false;

if (!input.feature) {
  log("No feature description passed — pass one via args, e.g. { feature: '…', ui: true }.");
}

const REPO_RULES = `Repo conventions are non-negotiable and live in the brain. Read what you need with
\`brain docs view rules/<layer>.md\` before editing. The five that fail CI: Effect TS (no throw, no
try/catch outside Effect.tryPromise), Effect Schema (no Zod), tagged errors in app/models/errors
mapped in tagToTRPC, a unit test for every helper and repository, and Cloudflare bindings (never
process.env).`;

// ---------------------------------------------------------------------------------------------
phase("Orient");

const CONTEXT_SCHEMA = {
  type: "object",
  required: ["summary", "files", "risks"],
  properties: {
    summary: { type: "string", description: "What already exists that this feature must fit into" },
    files: {
      type: "array",
      items: { type: "string" },
      description: "Existing files a builder will need to read or extend, repo-relative",
    },
    risks: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

// Three read-only lanes. None of them can conflict, and the architect needs all three.
const orient = await parallel([
  () =>
    agent(
      `Feature to build: ${feature}\n\nReturn the reading list for it: which .brain docs, rules and recipes the builders must open, and why each one. Do not suggest code.`,
      { label: "brain:reading-list", phase: "Orient", agentType: "brain-navigator" }
    ),
  () =>
    agent(
      `Feature to build: ${feature}\n\nFind the closest EXISTING feature in this repo and trace it end to end — schema, repository, tRPC procedure, route, tests. Report the pattern a new feature should copy, with file:line anchors. Read only.`,
      { label: "explore:nearest-feature", phase: "Orient", schema: CONTEXT_SCHEMA }
    ),
  ...(hasUi
    ? [
        () =>
          agent(
            `Feature to build: ${feature}\n\nUI-surface prep. Read .brain/rules/frontend.md and .brain/codebase/design-system.md, then report: is this tier 1 (pattern work — reuse existing components and states) or tier 2 (net-new surface needing a reference lock from /design-research)? Name the existing components, states and i18n namespaces it should reuse. Do NOT design anything and do NOT edit files.`,
            { label: "ui:tier-check", phase: "Orient" }
          ),
      ]
    : []),
]);

const orientNotes = orient.filter(Boolean);
log(`Orient: ${orientNotes.length} lanes returned`);

// ---------------------------------------------------------------------------------------------
phase("Contract");

const CONTRACT_SCHEMA = {
  type: "object",
  required: ["interface", "lanes", "acceptance"],
  properties: {
    interface: {
      type: "string",
      description:
        "The exact contract every lane builds against: Effect Schema input/output shapes, repository method signatures, tRPC procedure names, tagged errors. Source-level, not prose.",
    },
    contractFile: {
      type: "string",
      description: "Repo-relative path of the schema/types file that must be written FIRST",
    },
    lanes: {
      type: "array",
      description: "One entry per parallel build lane. Paths must not overlap between lanes.",
      items: {
        type: "object",
        required: ["name", "owns", "task"],
        properties: {
          name: { type: "string" },
          owns: {
            type: "array",
            items: { type: "string" },
            description: "Repo-relative paths this lane exclusively creates or edits",
          },
          task: { type: "string" },
          agentType: {
            type: "string",
            description:
              "One of: recipe-runner (schema/repo/procedure), ui-builder (any user-visible work), test-author (unit tests), general-purpose",
          },
        },
        additionalProperties: false,
      },
    },
    acceptance: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

const contract = await agent(
  `Feature: ${feature}

Orientation from three read-only lanes:
${orientNotes.map((n, i) => `--- lane ${i + 1} ---\n${typeof n === "string" ? n : JSON.stringify(n)}`).join("\n\n")}

${REPO_RULES}

Your job is the ONE genuinely sequential step: fix the interface so the remaining lanes can run in
parallel without talking to each other.

Produce:
1. \`interface\` — the exact source-level contract: Effect Schema inputs/outputs, repository method
   signatures, tRPC procedure names and their auth level, tagged errors and their tagToTRPC codes.
   Precise enough that a UI lane and a server lane written independently still compile together.
2. \`contractFile\` — the path of the schema/types file to write first (usually app/lib/schemas/<x>.ts).
3. \`lanes\` — the parallel build lanes. **Paths must be disjoint across lanes**; two lanes editing one
   file is the one thing this workflow cannot recover from. Typical split: data (db/schema + repo +
   repo tests) · api (tRPC procedure + its tests) · ui (route/components + i18n locale files)${wantsE2e ? " · e2e (spec only)" : ""}.
   Assign agentType per lane: recipe-runner for schema/repo/procedure work, ui-builder for anything
   user-visible, test-author for tests.
4. \`acceptance\` — the checks that prove the feature works, in terms a verifier can run.

Do not write code yourself.`,
  { label: "architect:contract", phase: "Contract", schema: CONTRACT_SCHEMA }
);

if (!contract) {
  // Fail loudly rather than fanning lanes out against an interface nobody agreed on.
  throw new Error("architect produced no contract — nothing safe to parallelise");
}

// The contract file is written once, by one agent, before the lanes fan out — everything downstream
// imports it, so it is the last sequential step.
if (contract.contractFile) {
  await agent(
    `Write ONLY this file: ${contract.contractFile}

It is the shared contract the parallel build lanes import, so it must compile on its own and match
this specification exactly:

${contract.interface}

${REPO_RULES}
Effect Schema, not Zod. Follow the existing files in app/lib/schemas/ for style. Touch no other file.`,
    { label: `contract:${contract.contractFile.split("/").pop()}`, phase: "Contract" }
  );
  log(`Contract file written: ${contract.contractFile}`);
}

// ---------------------------------------------------------------------------------------------
phase("Build");

const lanes = (contract.lanes ?? []).slice(0, 5);
log(`Build: ${lanes.length} lanes in parallel — ${lanes.map((l) => l.name).join(", ")}`);

const built = await parallel(
  lanes.map((lane) => () =>
    agent(
      `Feature: ${feature}
Lane: ${lane.name}

YOUR TASK
${lane.task}

THE CONTRACT — build against this exactly. Other lanes are building the other side of it right now,
so any deviation breaks a file you cannot see:
${contract.interface}
${contract.contractFile ? `\nThe contract already exists at ${contract.contractFile}. Import it; do not redefine it.` : ""}

FILE FENCE — you own these paths and only these paths:
${lane.owns.map((p) => `  · ${p}`).join("\n")}
Editing anything outside them will collide with a concurrent lane. If your task appears to need a
file you do not own, STOP and report it instead of editing it.

${REPO_RULES}

Return: the files you changed with a one-line summary each, and anything you could not do.`,
      {
        label: `build:${lane.name}`,
        phase: "Build",
        agentType: lane.agentType || "general-purpose",
      }
    )
  )
);

const buildReports = built.filter(Boolean);
if (buildReports.length < lanes.length) {
  log(`WARNING: ${lanes.length - buildReports.length} build lane(s) returned nothing — see Verify`);
}

// ---------------------------------------------------------------------------------------------
phase("Verify");

const VERDICT_SCHEMA = {
  type: "object",
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "string", enum: ["PASS", "FAIL", "BLOCKED"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "detail"],
        properties: {
          severity: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          detail: { type: "string" },
          file: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    evidence: { type: "string", description: "Verbatim command output tails that support the verdict" },
  },
  additionalProperties: false,
};

const acceptance = (contract.acceptance ?? []).join("\n  · ");

// Every verifier needs only the finished tree, so they all run at once. Each owns its own port where
// it needs a server — CI=1 is required while Cloudflare's edge-preview API is failing.
const verifications = await parallel([
  () =>
    agent(
      `Run the full verification checklist on the working tree for: ${feature}

Acceptance checks the architect specified:
  · ${acceptance}

Use a free port and CI=1 for anything needing a dev server (CI=1 skips the Workers-AI remote-bindings
proxy; without it the dev server cannot boot today). Report pass/fail per step with verbatim output
tails. Do not fix anything.`,
      { label: "verify:gates", phase: "Verify", agentType: "verify-done-runner", schema: VERDICT_SCHEMA }
    ),
  () =>
    agent(
      `Review the working-tree diff for: ${feature}\n\nAudit against the five non-negotiables. One line per violation, severity-tagged, no praise.`,
      { label: "verify:non-negotiables", phase: "Verify", agentType: "effect-ts-enforcer", schema: VERDICT_SCHEMA }
    ),
  () =>
    agent(
      `Audit the new code paths for: ${feature}\n\nAdd or correct tracing spans per the repo's naming convention. Report what you changed.`,
      { label: "verify:spans", phase: "Verify", agentType: "span-instrumenter" }
    ),
  ...(hasUi
    ? [
        () =>
          agent(
            `Prove the user-visible flow works for: ${feature}

Golden path plus one error path, driven through the LIVE app with the Playwright CLI on a port you
own. Use \`CI=1 bun run dev --port <free port>\`. Screenshot every step, and write the verdict doc to
.brain/features/${slug || "<slug>"}/verifications/<date>.md. Return PASS/FAIL and the screenshot paths.`,
            { label: "verify:browser-walk", phase: "Verify", agentType: "feature-verifier" }
          ),
        () =>
          agent(
            `Judge the rendered surface for: ${feature}

The build lane should have left screenshots — find them under .brain/features/ (or ask for them in
your report if absent). Score the anti-slop tells AND the craft signals, and run the litmus tests.
Judge pixels only; you may not read the route source. Return your usual verdict block.`,
            { label: "verify:design-critic", phase: "Verify", agentType: "design-critic" }
          ),
      ]
    : []),
]);

const verdicts = verifications.filter(Boolean);
const blocking = verdicts
  .filter((v) => v && typeof v === "object" && Array.isArray(v.findings))
  .flatMap((v) => v.findings.filter((f) => f.severity === "P0" || f.severity === "P1"));

// ---------------------------------------------------------------------------------------------
phase("Close");

const summary = await agent(
  `Synthesise the outcome of a parallel feature build. Do not edit any files — this is a report.

Feature: ${feature}

Contract the lanes built against:
${contract.interface}

Build lane reports:
${buildReports.map((r, i) => `--- ${lanes[i]?.name ?? `lane ${i + 1}`} ---\n${typeof r === "string" ? r : JSON.stringify(r)}`).join("\n\n")}

Verification results:
${verdicts.map((v) => (typeof v === "string" ? v : JSON.stringify(v, null, 1))).join("\n\n")}

Produce, in this order:
1. STATE — is the feature complete, and what is demonstrably true (cite the evidence, not the claim).
2. BLOCKING — every P0/P1 with the file and the fix, most severe first. Say "none" if none.
3. LANE COLLISIONS — any sign two lanes touched the same file or drifted from the contract.
4. HUMAN DECISIONS — anything a person must choose (schema trade-off, destructive migration, a
   design direction, a security question). Never decide these yourself.
5. BRAIN — the exact brain updates still owed: feature doc, feature_list status, progress checkpoint.
   List them; do not perform them.

Be blunt about what is unfinished. A confident summary of a broken tree is worse than no summary.`,
  { label: "close:synthesis", phase: "Close", effort: "high" }
);

return {
  feature,
  lanes: lanes.map((l) => l.name),
  contractFile: contract.contractFile ?? null,
  blockingFindings: blocking,
  verdicts: verdicts.map((v) => (v && v.verdict) || "see report"),
  summary,
};
