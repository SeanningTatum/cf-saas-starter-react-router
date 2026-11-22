/**
 * Dry runs of .claude/workflows/brand-init.js: every agent is a scripted answer, so these tests drive the
 * workflow's own branching (stops, resumes, fences, fix rounds, the ship gate) without a model call.
 *
 * They assert on the run (labels, agentType, phase, a few load-bearing prompt substrings, the result),
 * never on how the script is laid out, so moving its helpers into a shared library must keep them green.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configLine, labels, ledgerAt, callShape, rowShape, seq, type AnswerInput, type AnswerRule, type DryRunResult } from "../../lib/workflow-dry-run";

import { type Obj, ROOT, OUT, UI_DIR, ANSWERS, SHIP_ARGS, run, res, byLabel, one, indexOf, fenceIn, laneDid, tokensFor, PASS, SHIPPED, rules } from "./brand-init.fixtures";

/** Brief stop, then pick stop, then the build: the three runs a user drives by hand. */
let happy: Promise<{ r1: DryRunResult; r2: DryRunResult; r3: DryRunResult }> | undefined;
const happyPath = () =>
  (happy ??= (async () => {
    const r1 = await run({}, rules());
    const r2 = await run({ answers: ANSWERS }, rules(), r1);
    const r3 = await run({ answers: ANSWERS, pick: 2, rebuildHome: true }, rules(), r2);
    return { r1, r2, r3 };
  })());

describe("brand-init: happy path, Preflight to Ship", () => {
  it("stops for the brief, stops for the pick, then builds the picked comp and ships it once", async () => {
    const { r1, r2, r3 } = await happyPath();

    // Brief stop: only the guessed answer is asked. Catches asking every question, or none.
    expect(res(r1)).toMatchObject({ status: "needs-input", questions: [{ id: "users", draft: "Small teams" }] });
    expect(res(r1).questions).toHaveLength(1);
    expect(labels(r1.calls).at(-1)).toBe("memory:record:needs-input");
    // The resume replays preflight, recall and the interview from cache, and does not record the brief stop again.
    expect(labels(r2.calls.filter((c) => c.cached))).toEqual(["preflight", "memory:recall", "brief:interview"]);
    expect(r2.live[0].label).toBe("brief:write");
    expect(byLabel(r2, "memory:record:needs-input")).toEqual([]);
    expect(r3.live[0].label).toBe("contract:snapshot");

    // An answered id replaces its draft; an id left out keeps its draft. Catches dropping either.
    const write = one(r2, "brief:write").prompt;
    expect(write).toContain(ANSWERS.users);
    expect(write).toContain("Calm and exact");
    expect(write).not.toContain("Small teams");

    // Three comps drawn and critiqued; the taste loop edits comp.html, so it finishes before the
    // read-only critics look. Catches moving taste into the parallel critic pair.
    expect(res(r2)).toMatchObject({ status: "needs-pick", round: 1, needs: ["pick", "rebuildHome"], review: `${OUT}/pick-1.html` });
    expect(res(r2).comps.map((c: Obj) => c.id)).toEqual([1, 2, 3]);
    for (const id of [1, 2, 3]) {
      const taste = indexOf(r2, `critique:${id}:taste`);
      expect(indexOf(r2, `draw:${id}`)).toBeLessThan(taste);
      expect(taste).toBeLessThan(indexOf(r2, `critique:${id}:impeccable`));
      expect(taste).toBeLessThan(indexOf(r2, `critique:${id}:motion`));
      // The pick card shows the desktop shot, not whichever came first.
      expect(res(r2).comps[id - 1].screenshot).toBe(`${OUT}/${id}/shots/desktop-light.png`);
    }

    // The token layer is built from the tokens the taste loop left, not the first draw.
    // Catches using drawn.tokens after the critic changed the comp.
    const contract = one(r3, "contract:tokens").prompt;
    expect(contract).toContain('"name": "Comp 2 tasted"');
    expect(contract).not.toContain("Comp 2 drawn");

    const out = res(r3);
    expect(out).toMatchObject({
      pick: 2,
      rebuildHome: true,
      designMd: "DESIGN.md",
      fenceViolations: [],
      blockingFindings: [],
      escalations: [],
      unresolved: [],
      ship: SHIPPED,
      memory: { recalled: "nothing recorded", recorded: "recorded memory:record:ship" },
    });
    expect(out.rejected.map((r: Obj) => r.id)).toEqual([1, 3]);
    expect(out.verdicts).toEqual(
      ["impeccable critique", "taste critique (home)", "review-animations", "verify gates", "feature-verifier walk"].map((check) =>
        expect.objectContaining({ check, verdict: "PASS" })
      )
    );
  });

  it("commits and opens a PR in one call, in Ship, after the documenter, and the only memory write is the last call", async () => {
    const { r1, r2, r3 } = await happyPath();
    // Catches a lane or a stop that commits or opens a PR: only Ship may.
    for (const r of [r1, r2]) expect(r.calls.filter((c) => c.phase === "Ship")).toEqual([]);
    const committers = r3.calls.filter((c) => /ONE commit, one PR/.test(c.prompt));
    expect(labels(committers)).toEqual(["ship:record-commit-pr"]);
    expect(committers[0].phase).toBe("Ship");
    expect(labels(r3.calls.filter((c) => c.phase === "Ship"))).toEqual(["ship:record-commit-pr", "run:record:ship", "memory:record:ship"]);
    // DESIGN.md describes the shipped tree: it is written after every check and before the commit.
    expect(indexOf(r3, "close:design-md")).toBeGreaterThan(Math.max(...r3.calls.filter((c) => c.label.startsWith("check:")).map((c) => c.n)));
    expect(indexOf(r3, "close:design-md")).toBeLessThan(indexOf(r3, "ship:record-commit-pr"));
    // One record, once, at the end; lanes never record.
    expect(labels(r3.live.filter((c) => c.label.startsWith("memory:record:")))).toEqual(["memory:record:ship"]);
    expect(r3.calls.at(-1)?.label).toBe("memory:record:ship");
  });

  it("every phase is declared in meta and reached; every agent after Preflight is fenced to ROOT and runs as the right agent", async () => {
    const { r1, r2, r3 } = await happyPath();
    const declared = (r3.meta.phases ?? []).map((p) => p.title);

    // Catches a phase("...") or opts.phase typo that the progress UI cannot place, and a phase no run reaches.
    const reached = new Set([...r1.phases, ...r2.phases, ...r3.phases]);
    expect([...reached].sort()).toEqual([...declared].sort());
    for (const c of [...r1.calls, ...r2.calls, ...r3.calls]) expect(declared).toContain(c.phase);

    // An agent that starts in the launcher's checkout must be told where to work. Catches a call that skips the preamble.
    for (const c of r3.calls.filter((c) => c.label !== "preflight")) {
      expect(c.prompt.startsWith(`ROOT = ${ROOT}\nWork only inside ${ROOT}.`), c.label).toBe(true);
    }

    const typeOf = (label: string) => one(r3, label).opts.agentType;
    expect(typeOf("preflight")).toBe("runner");
    expect(typeOf("contract:snapshot")).toBe("runner");
    expect(typeOf("contract:tokens")).toBe("ui-builder");
    expect(typeOf("build:polish")).toBe("ui-builder");
    expect(typeOf("check:gates")).toBe("runner");
    expect(typeOf("check:browser-walk")).toBe("feature-verifier");
    expect(typeOf("close:design-md")).toBe("impeccable:impeccable-documenter");
    for (const c of r3.calls.filter((c) => c.label === "build:fence-diff")) expect(c.opts.agentType).toBe("runner");
    for (const c of r3.calls.filter((c) => c.label.startsWith("memory:"))) expect(c.opts.agentType, c.label).toBe("runner");

    const builds = r3.calls.filter((c) => c.label.startsWith("build:") && !["build:fence-diff", "build:polish"].includes(c.label));
    for (const c of builds) expect(c.opts.agentType, c.label).toBe("ui-builder");
    // rebuildHome: true adds the home lane and its taste check.
    expect(labels(builds)).toContain("build:home");
    expect(labels(r3.calls)).toContain("check:taste-critique");
    // shell imports the wordmark `shared` writes, so it runs after the whole parallel wave.
    expect(labels(builds).at(-1)).toBe("build:shell");

    // Disjoint fences: two lanes that own one file overwrite each other.
    const fences = new Map(builds.map((c) => [c.label, fenceIn(c.prompt)]));
    const all = [...fences.values()].flat();
    expect(new Set(all).size).toBe(all.length);
    // The primitive lanes cover app/components/ui exactly. Catches a new primitive that no lane rebrands.
    const primitives = [...fences].filter(([l]) => l.startsWith("build:primitives:")).flatMap(([, f]) => f);
    const onDisk = readdirSync(UI_DIR).filter((f) => f.endsWith(".tsx")).map((f) => `app/components/ui/${f}`);
    expect([...primitives].sort()).toEqual([...onDisk].sort());
  });

  it("every call names its agent type and none overrides the model: the agent's frontmatter is the one source", async () => {
    const { r1, r2, r3 } = await happyPath();
    // Catches a new ask() with no agentType (it would run as the default agent) and a `model:` on a call.
    for (const c of [...r1.calls, ...r2.calls, ...r3.calls]) {
      expect(typeof c.opts.agentType, `${c.label} names an agent type`).toBe("string");
      expect(c.opts, `${c.label} passes no model`).not.toHaveProperty("model");
    }
    const typeOf = (label: string) => one(r3, label).opts.agentType;
    expect(typeOf("check:impeccable-critique")).toBe("general-purpose");
    expect(typeOf("ship:record-commit-pr")).toBe("general-purpose");
    // The comps are drawn and tuned by the design lead; a read-only shell step deals the directions.
    expect(one(r2, "draw:1").opts.agentType).toBe("ui-builder");
    expect(one(r2, "critique:1:taste").opts.agentType).toBe("ui-builder");
    expect(one(r2, "draw:directions:1").opts.agentType).toBe("runner");
  });

  it("working memory goes through scripts/memory.ts on the runner, never a model editing the store", async () => {
    const { r1, r2, r3 } = await happyPath();
    const all = [...r1.calls, ...r2.calls, ...r3.calls];
    // Catches a record sent to the context-memory agent as a free-text prompt.
    expect(all.filter((c) => c.opts.agentType === "context-memory")).toEqual([]);

    expect(one(r1, "memory:recall").prompt).toContain("bun scripts/memory.ts recall brand-init");

    // The brief stop: fields on stdin, one `key: value` per line, with the same facts the old prompt carried.
    const stop = one(r1, "memory:record:needs-input").prompt;
    expect(stop).toContain("bun scripts/memory.ts record brand-init <<'MEMORY_EOF'");
    expect(stop).toContain("status: in-progress");
    expect(stop).toContain("stopped: Brief phase, status needs-input");
    expect(stop).toContain("waiting: the user's answers to 1 interview question(s), ids users");
    expect(stop).toContain("next: re-run Workflow brand-init with resumeFromRunId");
    expect(stop).toContain("todo: answer the open interview questions");
    expect(stop).toContain(`checkout ${ROOT}`);

    // The pick stop names every comp so a later session can find the files.
    const pick = one(r2, "memory:record:needs-pick").prompt;
    expect(pick).toContain("bun scripts/memory.ts record brand-init");
    expect(pick).toContain("waiting: the user's choice (pick and rebuildHome)");
    expect(pick).toContain(`3, Comp 3 tasted, ${OUT}/3/comp.html, taste 8`);

    // The ship record: done, the PR as a link, one decision per comp, no clock in any value.
    const ship = one(r3, "memory:record:ship").prompt;
    expect(ship).toContain("status: done");
    expect(ship).toContain(`link: PR: ${SHIPPED.pr}`);
    expect(ship).toContain(`link: commit: ${SHIPPED.commit}`);
    expect(ship.match(/^decision: /gm)).toHaveLength(3);
    expect(ship).toContain("todo: merge the PR after review");
    expect(ship).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("the gates run first and every check runs alone: parallel dev servers share one Vite cache and corrupt each other", async () => {
    // Each answer stays in flight for a few microtasks. Catches turning runChecks into a parallel() fan-out.
    const probe = () => {
      const p = { inFlight: 0, peak: 0 };
      const answer = (value: (c: AnswerInput) => unknown) => async (c: AnswerInput) => {
        p.peak = Math.max(p.peak, ++p.inFlight);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        p.inFlight--;
        return value(c);
      };
      return { p, answer };
    };
    const checks = probe();
    // Control: the build wave is parallel by design, so the same probe must see it overlap.
    const builds = probe();
    const r = await run(
      SHIP_ARGS,
      rules([
        [/^check:/, checks.answer(() => PASS)],
        [(c) => /^build:primitives:/.test(c.label), builds.answer((c) => laneDid(c))],
      ])
    );
    expect(checks.p.peak).toBe(1);
    expect(builds.p.peak).toBeGreaterThan(1);
    expect(r.calls.find((c) => c.label.startsWith("check:"))?.label).toBe("check:gates");
  });
});

describe("brand-init: a failing gate stops the run", () => {
  it("a red preflight, a relative root or a bad arg stops before any other agent", async () => {
    const red = await run({}, rules([["preflight", { ok: false, reason: "baseline red: typecheck", branch: "main", root: ROOT, config_json: configLine() }]]));
    expect(labels(red.calls)).toEqual(["preflight"]);
    expect(res(red)).toEqual({ error: "baseline red: typecheck" });
    // The DESIGN.md guard lives in the preflight agent; the script must hand it the redo flag.
    expect(red.calls[0].prompt).toContain("redo is false");
    const redo = await run({ redo: true }, rules([["preflight", { ok: false, reason: "dirty tree: app/root.tsx", branch: "main", root: ROOT, config_json: configLine() }]]));
    expect(redo.calls[0].prompt).toContain("redo is true");
    expect(labels(redo.calls)).toEqual(["preflight"]);

    // Every later agent is fenced to ROOT; a relative one would fence them to wherever they start.
    const relative = await run({}, rules([["preflight", { ok: true, reason: "", branch: "feat/brand-init", root: "work/acme", config_json: configLine() }]]));
    expect(labels(relative.calls)).toEqual(["preflight"]);
    expect(res(relative)).toEqual({ error: "preflight did not resolve an absolute repo root" });

    // A pick typed as a string would never match a comp id: rejected before any agent runs.
    const bad = await run({ pick: "2" }, rules());
    expect(bad.calls).toEqual([]);
    expect(res(bad).error).toMatch(/args\.pick/);
  });

  it("a gate still red after two fix rounds stops at needs-accept and nothing commits; declining ships nothing", async () => {
    // A red gate that names no finding: the run must still treat it as a P1.
    const redGate: AnswerRule = ["check:gates", { verdict: "FAIL", findings: [], evidence: "typecheck: 3 errors" }];
    const stopped = await run(SHIP_ARGS, rules([redGate]));

    expect(res(stopped)).toMatchObject({ status: "needs-accept", tag: "post-fix", review: `${OUT}/accept-post-fix.html` });
    expect(res(stopped).items).toEqual([expect.objectContaining({ severity: "P1", source: "verify gates", issue: expect.stringMatching(/^verdict FAIL with no blocking finding/) })]);
    // Two rounds and no third: the initial check plus one re-run per round.
    expect(byLabel(stopped, "check:gates")).toHaveLength(3);
    expect(labels(stopped.calls.filter((c) => c.label.startsWith("fix:") && c.label.endsWith("orphans")))).toEqual(["fix:1:orphans", "fix:2:orphans"]);
    // Nothing past the stop: no DESIGN.md, no commit.
    expect(stopped.calls.filter((c) => c.phase === "Close" || c.phase === "Ship")).toEqual([]);
    expect(stopped.calls.at(-1)).toMatchObject({ label: "memory:record:needs-accept:post-fix", phase: "Fix" });

    const declined = await run({ ...SHIP_ARGS, accept: { "post-fix": false } }, rules([redGate]), stopped);
    // The fix rounds replay from cache; only the report and the final record are new.
    expect(labels(declined.live)).toEqual(["close:synthesis", "run:record:ship", "memory:record:ship"]);
    expect(res(declined)).toMatchObject({ designMd: null, ship: { shipped: false }, escalations: [{ decision: "stop" }] });
  });

  it("accepting a visual finding does not let Ship pass a red gate; accepting a red gate the user saw does", async () => {
    // Catches Ship treating any accepted escalation as leave to commit over red gates.
    const p1: AnswerRule = ["check:impeccable-critique", { verdict: "FAIL", findings: [{ severity: "P1", issue: "card radius ignores --radius" }], evidence: "shots" }];
    const visual = await run({ ...SHIP_ARGS, accept: { "post-fix": true } }, rules([p1]));
    expect(one(visual, "ship:record-commit-pr").prompt).toContain("IF ANY GATE IS RED: STOP.");

    const gate: AnswerRule = ["check:gates", { verdict: "FAIL", findings: [{ severity: "P1", issue: "e2e: login spec times out" }], evidence: "tail" }];
    const sawGate = await run({ ...SHIP_ARGS, accept: { "post-fix": true } }, rules([gate]));
    const ship = one(sawGate, "ship:record-commit-pr").prompt;
    expect(ship).toContain("continue ONLY if every red gate was already failing");
    expect(ship).toContain(JSON.stringify(["e2e: login spec times out"]));
  });
});

describe("brand-init: stop at the pick and resume", () => {
  it("a re-run replays every call before the stop, never writes the stop's record twice, and moves on to Contract", async () => {
    const stopped = await run({ answers: ANSWERS }, rules());
    expect(res(stopped)).toMatchObject({ status: "needs-pick", needs: ["pick", "rebuildHome"] });
    const recordAt = indexOf(stopped, "run:record:needs-pick");
    expect(recordAt).toBe(stopped.calls.length - 2);

    // Same args again (the user has not answered yet): the record prompt carries no clock, so it replays.
    const again = await run({ answers: ANSWERS }, rules(), stopped);
    expect(again.live).toEqual([]);
    expect(again.result).toEqual(stopped.result);

    const resumed = await run({ answers: ANSWERS, pick: 3, rebuildHome: false }, rules(), stopped);
    expect(resumed.calls.slice(0, recordAt).every((c) => c.cached)).toBe(true);
    expect(resumed.live[0].label).toBe("contract:snapshot");
    expect(byLabel(resumed, "memory:record:needs-pick")).toEqual([]);
    expect(resumed.phases).not.toContain("Pick");
    expect(res(resumed)).toMatchObject({ pick: 3, rebuildHome: false, ship: { shipped: true } });
    // rebuildHome: false drops the home lane and its check. Catches building home.tsx the user said no to.
    expect(labels(resumed.calls).filter((l) => l === "build:home" || l === "check:taste-critique")).toEqual([]);
    expect(res(resumed).rejected.map((r: Obj) => r.id)).toEqual([1, 2]);

    // A pick that names no comp stops again and asks only for the pick. Catches building from an undefined winner.
    const typo = await run({ answers: ANSWERS, pick: 9, rebuildHome: true }, rules(), stopped);
    expect(res(typo)).toMatchObject({ status: "needs-pick", needs: ["pick"] });
    expect(byLabel(typo, "contract:snapshot")).toEqual([]);
  });

  it('"none" draws three fresh comps that avoid the first draw; a second "none" ends the run without building', async () => {
    const round2 = await run({ answers: ANSWERS, pick: "none" }, rules());
    expect(one(round2, "draw:directions:4").prompt).toContain("--avoid dir-1,dir-2,dir-3");
    expect(res(round2)).toMatchObject({ status: "needs-pick", round: 2, needs: ["pick2", "rebuildHome"], review: `${OUT}/pick-2.html` });
    expect(res(round2).comps.map((c: Obj) => c.id)).toEqual([4, 5, 6]);

    const rejected = await run({ answers: ANSWERS, pick: "none", pick2: "none" }, rules(), round2);
    expect(res(rejected).error).toMatch(/both sets of comps rejected/);
    expect(res(rejected).rejected.map((r: Obj) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
    // No third draw on its own, and nothing built.
    expect(labels(rejected.calls).filter((l) => l.startsWith("draw:directions:"))).toEqual(["draw:directions:1", "draw:directions:4"]);
    expect(rejected.calls.filter((c) => c.phase === "Contract" || c.phase === "Build")).toEqual([]);
  });

  it("look-alike comps get exactly one redraw, into its own directory, which replaces the original in the pick", async () => {
    const r = await run({ answers: ANSWERS }, rules([["critique:sameness", { pairs: [[1, 2], [2, 3]] }]]));
    // Catches redrawing every flagged pair, or redrawing in place (a failed redraw would corrupt the original).
    expect(labels(r.calls).filter((l) => l.startsWith("draw:") && l.endsWith(":redraw"))).toEqual(["draw:2:redraw"]);
    expect(one(r, "draw:2:redraw").prompt).toContain(`write only under ${OUT}/2-r/ and nowhere else`);
    expect(res(r).comps.map((c: Obj) => [c.id, c.html, c.redrawn])).toEqual([
      [1, `${OUT}/1/comp.html`, false],
      [2, `${OUT}/2-r/comp.html`, true],
      [3, `${OUT}/3/comp.html`, false],
    ]);
  });

  it("a redrawn comp's critics carry their own labels (catches two critic calls sharing one label, the first comp's and the redraw's)", async () => {
    const r = await run({ answers: ANSWERS }, rules([["critique:sameness", { pairs: [[1, 2]] }]]));
    const critics = labels(r.calls).filter((l) => l.startsWith("critique:2:"));
    expect(critics.sort()).toEqual([
      "critique:2:impeccable",
      "critique:2:impeccable:redraw",
      "critique:2:motion",
      "critique:2:motion:redraw",
      "critique:2:taste",
      "critique:2:taste:redraw",
    ]);
    expect(one(r, "critique:2:taste:redraw").prompt).toContain(`${OUT}/2-r/comp.html`);
  });
});

describe("brand-init: fix rounds", () => {
  const dialogP1 = { severity: "P1", issue: "dialog overlay ignores the radius token", file: "app/components/ui/dialog.tsx" };
  const checkLabels = ["check:gates", "check:impeccable-critique", "check:taste-critique", "check:review-animations", "check:browser-walk"];

  it("a finding goes to the lane that owns its file, with the finding in its prompt, and every affected check re-runs", async () => {
    const r = await run(SHIP_ARGS, rules([["check:impeccable-critique", seq({ verdict: "FAIL", findings: [dialogP1], evidence: "shots" }, PASS)]]));
    const fixes = r.calls.filter((c) => c.label.startsWith("fix:"));
    // Catches routing by anything but the hardcoded fences, or handing the lane no finding.
    expect(labels(fixes)).toEqual(["fix:1:primitives:dialogs-sheets"]);
    const fix = fixes[0];
    expect(fix.opts.agentType).toBe("ui-builder");
    expect(fix.prompt).toContain(`[P1] impeccable critique: ${dialogP1.issue} (${dialogP1.file})`);
    expect(fenceIn(fix.prompt)).toEqual(["app/components/ui/dialog.tsx", "app/components/ui/alert-dialog.tsx", "app/components/ui/sheet.tsx", "app/components/ui/drawer.tsx"]);
    // A change under app/components/ can touch every surface: every check runs again, after the fix.
    for (const label of checkLabels) {
      const runs = byLabel(r, label);
      expect(runs, label).toHaveLength(2);
      expect(runs[1].n).toBeGreaterThan(fix.n);
    }
    expect(res(r)).toMatchObject({ blockingFindings: [], ship: { shipped: true } });
  });

  it("a finding no fix clears gets two rounds, not three, then stops at needs-accept", async () => {
    const r = await run(SHIP_ARGS, rules([["check:impeccable-critique", { verdict: "FAIL", findings: [dialogP1], evidence: "shots" }]]));
    expect(labels(r.calls.filter((c) => c.label.startsWith("fix:")))).toEqual(["fix:1:primitives:dialogs-sheets", "fix:2:primitives:dialogs-sheets"]);
    expect(byLabel(r, "check:impeccable-critique")).toHaveLength(3);
    expect(res(r)).toMatchObject({ status: "needs-accept", tag: "post-fix", items: [expect.objectContaining({ source: "impeccable critique", file: dialogP1.file })] });
    expect(byLabel(r, "ship:record-commit-pr")).toEqual([]);
  });

  it("fence check, both ways: an edit in another lane's file and an edit no lane admits to are each P0 and repaired", async () => {
    const r = await run(
      SHIP_ARGS,
      rules([
        // primitives:feedback says it also edited button.tsx, which primitives:buttons-toggles owns.
        ["build:primitives:feedback", (c: AnswerInput) => laneDid(c, ["app/components/ui/alert.tsx", "app/components/ui/button.tsx"])],
        // The git diff shows a file no lane listed.
        ["build:fence-diff", (c: AnswerInput) => ({ paths: c.phase === "Build" ? ["PRODUCT.md", "vite.config.ts"] : ["PRODUCT.md"] })],
        ["fix:1:repair:primitives:feedback", { files: ["app/components/ui/button.tsx"], reverted: ["app/components/ui/button.tsx"], report: "reverted my lines", cwd: ROOT }],
        ["fix:1:revert-strays", { files: ["vite.config.ts"], reverted: ["vite.config.ts"], report: "restored", cwd: ROOT }],
      ])
    );
    expect(r.logs).toContain("P0 FENCE VIOLATION: primitives:feedback touched app/components/ui/button.tsx");
    expect(r.logs).toContain("P0 FENCE VIOLATION: unattributed touched vite.config.ts");

    // The offender repairs its own edit, held to its own fence; it must not git checkout a file another lane owns.
    const repair = one(r, "fix:1:repair:primitives:feedback");
    expect(repair.opts.agentType).toBe("ui-builder");
    expect(repair.prompt).toContain("FENCE REPAIR");
    expect(repair.prompt).toContain("outside your fence:\n  · app/components/ui/button.tsx\nYour fence:\n  · app/components/ui/alert.tsx");
    expect(repair.prompt).toContain("PRODUCT.md"); // dirty before the build: never touch it
    // The owner of button.tsx is not asked to undo anything.
    expect(labels(r.calls).filter((l) => l.includes("buttons-toggles"))).toEqual(["build:primitives:buttons-toggles"]);

    const strays = one(r, "fix:1:revert-strays");
    expect(strays.opts.agentType).toBe("runner");
    expect(strays.prompt).toContain("vite.config.ts (touched by unattributed)");

    expect(labels(r.calls).filter((l) => l.startsWith("fix:2:"))).toEqual([]);
    expect(res(r)).toMatchObject({ fenceViolations: [], blockingFindings: [], ship: { shipped: true } });
  });

  it("a fence violation stays open until the offender reports it reverted, so a quiet repair cannot clear it", async () => {
    const r = await run(SHIP_ARGS, rules([["build:primitives:feedback", (c: AnswerInput) => laneDid(c, ["app/components/ui/alert.tsx", "app/components/ui/button.tsx"])]]));
    // The default repair answer changes and reverts nothing.
    expect(labels(r.calls).filter((l) => l.includes(":repair:"))).toEqual(["fix:1:repair:primitives:feedback", "fix:2:repair:primitives:feedback"]);
    expect(res(r)).toMatchObject({
      status: "needs-accept",
      items: [expect.objectContaining({ severity: "P0", source: "fence:primitives:feedback", file: "app/components/ui/button.tsx" })],
    });
    expect(byLabel(r, "ship:record-commit-pr")).toEqual([]);
  });
});

describe("brand-init: run ledger", () => {
  const drawn = () => ({ html: `${OUT}/1/comp.html`, tokens: tokensFor(1, "drawn"), screenshots: [`${OUT}/1/shots/mobile-light.png`, `${OUT}/1/shots/desktop-light.png`] });

  it("at the brief stop, the pick stop and Ship the run:record ledger lists exactly the calls made before it, in order, and its check line verifies: a call that dodges the ledger gives a false cost report", async () => {
    const { r1, r2, r3 } = await happyPath();
    for (const [r, label] of [
      [r1, "run:record:needs-input"],
      [r2, "run:record:needs-pick"],
      [r3, "run:record:ship"],
    ] as const) {
      const lg = ledgerAt(r, label);
      expect(lg.verifies).toBe(true);
      expect([lg.workflow, lg.slug]).toEqual(["brand-init", "brand-init"]);
      expect(rowShape(lg.rows)).toEqual(r.calls.slice(0, lg.at).map(callShape));
    }
  });

  it("a re-run with the same args replays the stop's run:record call from cache with the same prompt: the ledger holds no clock and no random value", async () => {
    const { r2 } = await happyPath();
    const again = await run({ answers: ANSWERS }, rules(), r2);
    const before = one(r2, "run:record:needs-pick");
    const after = one(again, "run:record:needs-pick");
    expect(after.cached).toBe(true);
    expect(after.prompt).toBe(before.prompt);
    expect(again.live).toEqual([]);
  });

  it.each([
    ["a dead agent", null, "empty"],
    [
      "a thrown error",
      () => {
        throw new Error("rate limited");
      },
      "threw",
    ],
  ] as const)("%s on the first try shows outcome %s with attempt 1, then the retry shows attempt 2: the ledger must tell a retry from a first try", async (_who, first, outcome) => {
    const r = await run({ answers: ANSWERS }, rules([[/^draw:1$/, seq(first, drawn)]]));
    const lg = ledgerAt(r, "run:record:needs-pick");
    expect(lg.rows.filter((row) => row.label === "draw:1").map((row) => [row.attempt, row.outcome])).toEqual([
      [1, outcome],
      [2, "ok"],
    ]);
    expect(lg.rows.filter((row) => row.attempt === 2)).toHaveLength(1);
  });

  it("the PR body gets the run summary and the pick and accept stops tell the main thread to show it: a PR or a review page without the telemetry table breaks the ticket's second criterion", async () => {
    const { r2, r3 } = await happyPath();
    expect(one(r3, "ship:record-commit-pr").prompt).toContain("`## Run` heading and the output of `bun scripts/run-telemetry.ts summary brand-init --markdown`");
    expect(res(r2).next).toContain("`bun scripts/run-telemetry.ts summary brand-init`");
    const stopped = await run(SHIP_ARGS, rules([["check:gates", { verdict: "FAIL", findings: [], evidence: "typecheck: 3 errors" }]]));
    expect(res(stopped).next).toContain("ingest brand-init brand-init <this run's transcript directory>");
  });
});
