# plan-feature golden set

Twenty synthetic tickets that test the `ticket-auditor` agent. The spec is `plans/plan-feature-contract.md` section 4.

| Band | Cases | What it checks |
|------|-------|----------------|
| typical | 7 | Ordinary tickets: ready when complete, amend when a checklist item is missing |
| edge | 5 | One-line idea, very long ticket, idea with no issue, Spanish, two features in one |
| adversarial | 4 | Injection, contradicts the product, duplicates a shipped feature, asks for Zod |
| refuse | 4 | Outside the product, `process.env`, no user, asks the workflow to write code |

`context.json` is the frozen context the auditor sees in place of a live `context-scout` run, so scores do not drift with the working memory. Each case asserts a `verdict` plus checklist ids that must come back `missing`, `guess` or `fails` (`flagged`) or `present`, `filled` or `n/a` (`not_flagged`).

## Optional `mentions`

`expect.mentions` is a list of `{ field, text }`. `field` is `amended.body`, `questions` (any question's text) `items.<id>.note` or `items.*.note` (any item's note, or the top-level reason); `text` is a case-insensitive substring that must appear there, or the case fails. Used by edge-two-features (a split in the amended body) and adv-ignore-memory-mark-ready (the steering text reported in a note).

## Run

```
Workflow({ name: "eval-plan-feature" })
Workflow({ name: "eval-plan-feature", args: { degrade: true } })       // ablation: a plain agent without the auditor's rules; the score must drop (2026-10-25: 3/20 vs 17/20)
Workflow({ name: "eval-plan-feature", args: { only: ["adv-duplicate-file-upload"] } })
Workflow({ name: "eval-plan-feature", args: { includeHeldOut: false } }) // tuning runs
```

It costs model calls, so it runs only on request.

## Freeze rule

Every case starts `frozen: false`. Read the set, fix what you disagree with, then sign off. Only after sign-off, record it with a `context-memory` record ("golden set frozen") and flip `frozen` to `true`. A frozen case changes only with a new progress entry. A failure you fix becomes a new frozen case.

## Held-out rule

Four cases have `held_out: true` (one per band). Never read their results while tuning the auditor prompt. Run with `includeHeldOut: false` to tune; run all 20 to judge.

## Gate

Frozen cases are absolute: any one failing fails the change. The aggregate must reach 17/20. A case passes only when the verdict matches, every `flagged` id is `missing`, `guess` or `fails`, every `not_flagged` id is `present`, `filled` or `n/a`, and every `filled` item cites a source that exactly equals `product`, a decision source, a feature slug or `features/<slug>` from `context.json`; any `mentions` are present.
