# Run note: the design gate shipped slop, and why it couldn't tell

- **Date**: 2026-07-30
- **Trigger**: user review of the first `/demo` surface — "still generic slop, our agent / skills are not doing a great job". Correct on both counts.
- **Outcome**: surface rebuilt on a new reference lock; three process holes closed; new `design-critic` sub-agent added as the gate that was missing.

## What shipped, and what was wrong with it

The first `/demo` passed **every** gate the repo had: typecheck, 269 unit tests, build, e2e 6/6, a coordinator browser walk, two independent worker walks, and a Greptile code review at 3/5 with all findings fixed. It was still templated. Scored against the `refero-design` skill's own `references/anti-ai-slop.md` — a file that ships with the skill and that **nothing in the process required anyone to read** — it failed six checks:

| Tell / test | Failure |
|---|---|
| #2 Cards everywhere | Three stat "cards" + three step "cards" + an icon-in-a-box, none interactive. The card test (remove border/shadow/bg/radius — does anything break?) says they were never cards. |
| #3 Dark mode by default | The brief never asked for dark. A dark reference was *chosen*, which is the AI fingerprint with a citation attached. |
| #4 Decorative one-word colour highlight | "one board" in crimson — named in the reference as a current AI default. |
| Layout symptom | Hero with copy left, product panel right. |
| Layout symptom | Six uniform bands: heading → subtitle → grid-of-three, same max-width, same padding. |
| Identity test | Cover the wordmark and it could be any ops SaaS. |
| Copy test | Deleting 30% improved it — and did, in the rebuild. |

## Root causes — three, all structural

**1. The gate never required the anti-slop reference.** `/design-research` (written in the same session) sequenced research, synthesis and a decision ledger, but never said "read the checklist you will be judged against". So the checklist was never opened.

**2. The primary reference was picked for buildability.** Andercore was the strongest *logistics* reference and was demoted because its weight is carried by industrial photography that could not be produced — the easiest reference (Orderful, itself a fairly generic enterprise site) was promoted in its place. That is "optimise for safe" wearing a reference-lock costume, and it is exactly tell #7 (reference averaging) arriving by a side door. The honest move is to treat a demanding reference as a **media problem to solve**, not a reason to demote.

**3. Verification was functional-only, so no gate could fail a design for looking generic.** Both worker walks asserted row counts, contrast ratios, focus order and horizontal overflow. Greptile reviews code. The feature-verifier proves flows work. Every one of them passes happily on a templated page. There was no critic.

A fourth, smaller one: the skill's own workflow says a landing page should be offered as **three reference-locked directions for the user to choose**. That step was skipped, so the surface got the one direction the agent already preferred.

## Fixes landed

- **New [`design-critic`](../../.claude/agents/design-critic.md) sub-agent** — judges *screenshots*, explicitly forbidden from reading the route source (intent is not a defence), scores the nine tells + the layout symptoms + six litmus tests, returns P0–P3 and `SHIP` / `DO NOT SHIP`. Runs `opus`: telling "restrained" from "generic" is taste work, and a cheaper model rates its own defaults as fine. Forbidden to praise, forbidden to fix.
- **[`/design-research`](../../.claude/commands/design-research.md) restructured** — anti-slop reference is now step 3 (before any direction is chosen, with the three at-risk tells named up front); three-directions-and-ask is step 7; "pick on distinctiveness, never buildability" is step 8 with the demotion rule written out; the critic is step 13 and P0/P1 block.
- **[`rules/frontend.md`](../rules/frontend.md)** tier 2 gained four rules: read the anti-slop file first, pick on distinctiveness, composition comes from the primary ("if the section stack would be identical under any other reference, only tokens were taken"), and run the critic before done.

## The rebuild

Direction chosen by the user from three offered: **Waybill**, primary 19–86 (`7a8c99db`) — architectural blueprint on white. Freight runs on documents, so the page is typeset as one. Composition changed, not polished: monument (a 352px figure — minutes since a truck last checked in — in the same weight as body copy), then a full-bleed hairline-ruled manifest with the **marketing copy inside the table** as annotations on the rows that prove each claim, then a ruled ledger, a ruled sequence, a sign-off. No cards. No hue at all. One weight. `--radius: 0`.

Two things the rebuild removed that were not obvious:

- The `LanguageSwitcher` and `ThemeToggle` ShadCN components were dropped from the masthead. They dragged in a shadow, a radius and `font-weight: 500` — three traits the lock forbids — and a **theme toggle on a surface that pins itself light is dishonest UI**. Locale switching is now two ruled text buttons posting to the same `/api/set-locale` action.
- `boardFilters` was deleted rather than left dangling once the pill row went.

Automated slop probe on the render (in-browser, counts rather than opinions): 0 chromatic elements, 0 radii above zero, 0 shadows, 0 font weights above 400, 58 hairline rules.

## The anti-slop checklist is a floor

Pass three (Waybill) scored clean on every tell and the human verdict was "lame and boring as hell". The critic had already said it politely — the system "transfers to any data-heavy B2B product without changing one rule", "the bottom 47% of the page is still forgettable" — and the checklist could not fail it, because the checklist only measures ways to be *bad*.

Three additions to how tier 2 gets run, all now in [`rules/frontend.md`](../rules/frontend.md) and [`/design-research`](../../.claude/commands/design-research.md):

1. **A clean checklist is not a passing grade.** Ask the memorability and identity questions *before* implementation, not after: what will a viewer recall tomorrow, and could this belong to another company or another category?
2. **Distinctive is not the same as appropriate.** An archival architecture portfolio was a genuinely distinctive reference and completely wrong for a product about trucks going dark at 3am. Check the reference against the *domain's own visual world* — freight has DOT guide signs, reflective tape, hazard placards, dot-matrix rate cons — before reaching for a design-canon reference.
3. **Consider motion.** Three passes shipped a still page for a product whose whole nature is that it moves. If the subject changes over time, the design has a time dimension and ignoring it is a decision, not a default.

## What to carry forward

- A functional gate cannot catch a design defect. If you want design quality, something must judge pixels and be allowed to say no.
- "It matches the reference" is not the same as "it isn't generic". Check both, and check the *composition*, not just the tokens.
- When an agent rejects the strongest option for a practical reason, that is the moment to be suspicious — the practical reason is usually how the safe choice wins.
