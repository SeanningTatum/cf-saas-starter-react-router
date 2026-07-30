---
description: Build a feature with the harness sub-agents fanned out in parallel — orient, fix the contract, parallel build lanes on disjoint files, parallel verification, synthesis
---

Run the [`build-feature`](../workflows/build-feature.js) workflow. Invoking this command **is** the
opt-in to multi-agent orchestration — call the `Workflow` tool directly, do not ask again.

## Before you launch

1. **Scope check.** This workflow is for a feature spanning more than one layer (schema / repository /
   procedure / UI). For a one-file change it is pure overhead — do that inline or with a single
   sub-agent. If the ask is one file, say so and stop.
2. **Scope policy.** `brain features --status in-progress`. One in-progress feature at a time — if
   another is open, mark it `blocked` with a reason first or stop and ask.
3. **Clean tree.** `git status --short`. Parallel lanes writing over uncommitted work makes the diff
   unreadable. Commit or stash first.
4. **Baseline.** `./init.sh --baseline`. If it is already red, stop — you will not be able to tell
   your failures from the ones that were already there.

## Launch

```
Workflow({
  name: "build-feature",
  args: {
    feature: "<one paragraph: what the user can do afterwards that they cannot do now>",
    slug: "<feature slug, for the verification doc path>",
    ui: true,        // false for a server-only feature — skips the UI lane and the design critique
    e2e: true        // false to skip the e2e lane
  }
})
```

Write the `feature` description properly. Every lane reads it, and it is the only shared statement of
intent they get. Say what becomes possible, for whom, and any constraint that is not negotiable.

## What it does

| Phase | Runs | Why |
|---|---|---|
| **Orient** | 3 read-only lanes in parallel — brain reading list · trace of the nearest existing feature · UI tier check | None can conflict, and the architect needs all three |
| **Contract** | 1 architect, then 1 writer for the contract file | The **only** genuinely sequential step: fix the interface, then nobody has to wait |
| **Build** | up to 5 lanes concurrently, each fenced to disjoint paths | Once the interface is fixed, the server lane and the UI lane need nothing from each other |
| **Verify** | gates · non-negotiables · spans · browser walk · design critique, all at once | Each needs only the finished tree. Browser lanes each own a port |
| **Close** | 1 synthesis | States what is true with evidence, what blocks, what a human must decide, and the brain updates still owed |

~13 agents for a UI feature, ~9 for server-only.

## The one rule that makes it safe

**Parallel writers own disjoint paths.** The Contract phase assigns file ownership per lane and each
lane prompt repeats its own fence with an instruction to stop rather than edit outside it. Two agents
editing one file is the failure mode this design trades away — so if the synthesis reports a lane
collision, treat that as a P0 and re-run the affected lane sequentially.

## After it returns

The workflow **does not commit, does not touch brain state, and does not decide anything a human
should**. You do:

1. Read `blockingFindings` first. Fix every P0/P1 before anything else — dispatch the owning agent
   again rather than fixing by hand where an agent owns the layer.
2. Read the synthesis' `HUMAN DECISIONS` section. Answer them or bring them to the user; never pick
   for them on a schema trade-off, a destructive migration, or a security question.
3. Run [`/verify-done`](verify-done.md) yourself. The workflow's verification lanes are evidence, not
   a substitute for the gate.
4. Brain updates the synthesis lists: feature doc, `feature_list.json` status, progress checkpoint —
   via `feature-tracker` / `brain progress add`.
5. Commit. One commit per logical change, not one per lane.

## When not to use it

- One-file changes, typo fixes, copy edits.
- Anything where you do not yet know the interface — do the design work first, or the lanes will build
  against a guess. `/design-research` for a net-new surface; a plan for anything ambiguous.
- A red baseline.
- Exploratory work where the goal is to learn what the shape should be. Fan-out is for when the shape
  is known.
