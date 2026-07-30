# Recipe: build a surface that looks shipped, not generated

For a **high-visibility net-new surface** — a landing page, a marketing surface, a redesign of
something a prospect sees before they trust you. Not for another modal or a spacing fix (that is
tier 1: `brain docs view rules/frontend.md`).

> **Where this came from.** `/demo` was rebuilt five times. Four were rejected — "generic slop",
> "lame and boring as hell", "so ass". Every rejection traced to one of the moves in step 4, and
> every one of my four failures came from a mistake in steps 1–3. This recipe is that ground, walked
> once, so nobody has to walk it again. Full history:
> [`../runs/2026-07-30-design-slop-postmortem.md`](../runs/2026-07-30-design-slop-postmortem.md).

---

## 1. Look at the category before you look at references

Open the **three best real products** in the category and say what they do that a template does
not. Not Refero yet — the actual competitors, because that is the bar the surface will be judged
against.

For software, that list is almost always: *they show the product*, they have a real typeface, and
they have depth. Write down what you are matching.

**Trap:** skipping to design references produces a page that is distinctive against a mood board and
generic against the market.

## 2. Research references — and pick the primary on distinctiveness, not buildability

Full method in [`/design-research`](../../.claude/commands/design-research.md) (styles → screens →
flows, three directions, one dominant). Two rules that cost me three passes:

- **Read `~/.claude/skills/refero-design/references/anti-ai-slop.md` first.** It is a floor, not a
  grade. Passing every tell is what "boring" looks like from the inside.
- **Never demote the strongest reference because it is hard to build.** Photography you cannot
  produce is a media problem to solve, not a reason to promote the easy reference. That demotion is
  how the safe option wins while wearing a citation.

## 3. Do not build the metaphor literally

The single biggest failure of the four rejected passes. A concept ("freight runs on documents",
"dispatch is the road") should inform **tone, palette, density, and what the page shows**. Rendering
it as its physical object — a page that *is* a waybill, a hero that *is* a road sign — is a costume.
It reads as a themed novelty and it ages badly.

Litmus: if the page's central move can be described as "it looks like a real \<physical thing\>",
stop and use the concept as direction instead of scenery.

## 4. Build the craft. These are the moves, concretely

This is the part that separates the accepted pass from the four before it.

**Show the product.** For software, the hero visual is the product's own UI, rendered as a real
panel — window chrome, real columns, real rows, hover states, a live value. Not a screenshot pasted
into a column, and not a metaphor standing in for it. Let it bleed past the container so the page
reads as a window into a running app, and check that the bleed does not clip the one column that
matters.

**Three surface levels, no more.** Canvas → raised panel → panel header. Each step small. Never
pure black on a dark direction (`#08090A`, not `#000`).

**Depth is four details, not a shadow.** Hairline border at 6–10% alpha · a 1px inner highlight on
the top edge where light would catch it · one soft, wide, low-opacity drop shadow · one ambient glow
behind the hero panel, and *only* there. Optionally a barely-visible grid field so large dark areas
do not read as void.

```css
.raised {
  background: linear-gradient(180deg, #12151a 0%, #0e1013 60%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),   /* the light catching the edge */
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 24px 60px -20px rgba(0, 0, 0, 0.8);
}
```

**Two real type faces.** A distinctive grotesque for display, a real mono for data. Framework
default + no mono is most of the distance to "generated". Set display tracking around `-0.028em`;
give the mono `font-variant-numeric: tabular-nums` so live figures do not reflow.

**One accent, counted.** Pick a colour with a reason (night work → amber; not indigo — see the
anti-slop tell). Spend it on: the primary action, the one alarm state, live indicators. Then
**measure it** (step 5). Over ~4% of painted elements and it has become decoration.

**Motion at the subject's real cadence.** If the thing being measured changes over time, the page
should too — a figure that climbs once a minute, a beacon that pulses, an 8px/400ms rise on load.
Gate every one behind `prefers-reduced-motion`.

**One memorable move, structural.** Not a device — a continuity. On `/demo` it is one load carried
through three registers: hero panel row → the same row highlighted → its event ledger. Ask: what
would a viewer describe tomorrow?

## 5. Measure the mechanics before asking anyone's opinion

```bash
CI=1 bun run dev --port 5231           # CI=1 skips the remote-bindings proxy session
bun run design:audit -- --url http://localhost:5231/<route> \
  --scope '[data-surface="<scope>"]' --accent '#FFB02E'
```

[`scripts/design-audit.ts`](../../scripts/design-audit.ts) reports surface levels, type faces,
display sizes, radii, shadowed/bordered/panel counts, chromatic colour count, **accent economy as a
percentage**, product data rows on the page, body + action contrast, animated element counts with
and without reduced motion, and overflow at both viewports.

It exits non-zero only on real defects: horizontal overflow, contrast below AA, animation that
ignores reduced motion, console errors. Everything else is a craft note for judgement.

## 6. Then let the critic judge taste

Spawn [`design-critic`](../../.claude/agents/design-critic.md) with the screenshots, the reference
lock, the one-line brief, **and the audit output**. It judges pixels and never reads the route
source. P0/P1 block. Paste its verdict into the verification doc.

Give it the audit numbers so it argues about taste rather than re-deriving measurements — and so
"it looks premium" is never the claim being assessed.

## 7. Close out

- Record the reference lock and the decision ledger in `.brain/features/<slug>/<slug>.md`. **A
  surface whose recorded lock is stale has nothing to audit against** — the critic caught exactly
  that on `/demo`.
- Tests that pin the design's intent, not its pixels: the live figure's source of truth, that status
  is stated in words and not only colour, that the scope's tokens do not leak. Select by `data-testid`,
  never by column index — column counts are design decisions.
- `/verify-done`, then the usual feature close-out.

---

## The four rejections, in one line each

| Pass | Direction | Why it failed |
|---|---|---|
| 1 | Andercore dark + crimson, ShadCN cards | Cards as default containers, dark with no brief, decorative one-word colour highlight, hero-left/product-right, six identical bands |
| 2 | same, scoped tokens | Changed the palette, kept the composition |
| 3 | 19–86 "Waybill", austere black on white | Passed every anti-slop tell and was boring. Wrong reference for the domain; no product shown; nothing moved |
| 4 | MUTCD highway signage | Metaphor built literally — a costume. Green/orange/yellow is ugly. Still no craft: no depth, no real face, no product panel |
| 5 | dark premium, product-led | Accepted |
