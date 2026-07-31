---
description: Reference-grounded design research before net-new or complex UI — Refero styles/screens/flows + ui-ux-pro-max rules → locked direction + decision ledger in the brain
---

Gate for **tier 2** frontend work (see [`.brain/rules/frontend.md`](../../.brain/rules/frontend.md) "Design intelligence"): a new surface, a redesign, a multi-step journey, or any "make this beautiful / premium" ask. Do **not** write JSX until step 7 is written down.

Skip this command for tier-1 work (another modal, another table, a spacing or a11y fix) — query `ui-ux-pro-max` inline instead.

Steps:

0. **Look at the category before the references.** Open the three best real products in this category and write down what they do that a template does not — that is the bar this surface gets judged against, and design references alone will not tell you. For software the answer is almost always: they show the product, they have a real typeface, they have depth. Skipping this step produces a page that is distinctive against a mood board and generic against the market.

1. **Derive the lock status first.** `brain docs view codebase/design-system.md` + `brain docs view rules/frontend.md`, then run the derivation from that file's `Lock status` section:

   ```bash
   grep -q '"name": "cf-saas-starter-react-router"' package.json \
     && git remote get-url origin 2>/dev/null | grep -q 'SeanningTatum/cf-saas-starter-react-router' \
     && echo ACTIVE || echo NONE
   ```

   The status is derived from both signals rather than written down, precisely so a fork cannot inherit it. If you already know you are in a forked product, the answer is `NONE` regardless of what this prints. State which of the three cases you are in before anything else:
   - `NONE` → **no direction is locked.** This repo was forked from the starter and has not done its own research. Everything in `design-system.md` describes the *starter's* landing page (Cursor + Linear, dev-tool monochrome) and is a worked example, not a spec — do not research "within" it, and do not carry its references forward because they are the ones already written down. Run the full flow below from scratch, and at step 10 rewrite `design-system.md` with this product's own direction and flip its status to `ACTIVE`.
   - `ACTIVE` + **extending** → the direction (Cursor + Linear, restrained/technical, single accent, mono for tech labels) holds; research *within* it. Default on the starter itself.
   - `ACTIVE` + **re-opening** it (deliberate redesign) → say so explicitly and get the user's confirmation before continuing. This ends with a `design-system.md` rewrite in the same PR.

2. **Write the brief** (4–6 lines, in your reply): what surface, who it is for, the primary user goal, the feeling to hit, the objection to overcome, hard constraints (React Router + ShadCN + Tailwind + existing tokens, i18n via `app/locales/**`, both themes unless a reference lock pins one — see "Scoped design systems" in `rules/frontend.md`). Ask the user only for what would materially change the outcome; otherwise assume and proceed.

3. **Read the anti-slop reference before choosing anything**: `~/.claude/skills/refero-design/references/anti-ai-slop.md`. Not a skim — you will be scored against its checklist in step 10, and the fastest way to fail is to design first and read it after. Note in your reply the three tells this particular surface is most at risk of.

4. **Invoke the `refero-design` skill** — it owns the methodology (research before design, no single-reference copying, no averaging into a safe middle, no token-meaning changes, validate the render against the lock). Do not hand-roll the MCP calls in its place.

5. **Research all three Refero layers** (combine — never one):
   - `refero_search_styles` → `refero_get_style` on the 2–3 strongest hits. Visual language, type system, section rhythm, elevation, imagery role.
   - `refero_search_screens` (`platform: "web"`) → `refero_get_screen` / `refero_get_similar_screens` / `refero_get_screen_image`. Search by what is literally on the screen, not by adjective.
   - `refero_search_flows` → `refero_get_flow` **when the surface is multi-step** (sign-up, upload, onboarding, cancellation). Skip for single screens and say why.

   If the `refero` MCP tools are unavailable (`REFERO_MCP_TOKEN` unset), say so plainly, fall back to the skill's bundled craft references, and note the degradation in the run note. Never substitute training-data taste silently.

6. **Cross-check with `ui-ux-pro-max`** (tier 1) for the non-negotiable rules Refero does not enforce: contrast ≥ 4.5:1, 44×44 touch targets, focus rings intact, visible labels, error near field, reduced-motion, no horizontal scroll, chart legends/tooltips.
   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain ux
   ```

7. **Offer three reference-locked directions and let the user choose.** This is the skill's own workflow for a landing page or other high-visibility surface, and skipping it is how a surface ends up with the safest available direction. Each option: primary source + traits to preserve + borrowed details + media strategy + rejects. Do not proceed on your own preference.

8. **Pick the primary on DISTINCTIVENESS, never on buildability.** The failure mode is subtle and it is the one that actually happened here: an image-led or otherwise demanding reference gets rejected as primary "because we cannot produce the photography", the easiest reference is promoted, and the result is average with a citation. If the strongest direction needs media you cannot make, that is a **media problem to solve** (generate the asset, use an intentional placeholder with real art direction and a fixed aspect ratio, or find a code-native primitive the reference itself would sanction) — not a reason to demote it. If you demote a reference, write down what specifically was unbuildable and why the substitute preserves the trait.

9. **Synthesize — one dominant direction.** Keep the primary's sharp traits; secondaries contribute narrow details only. If two references conflict, choose, do not blend. State what is deliberately *not* being taken. Composition comes from the primary: if your section stack would be identical with any other reference, you have taken tokens and left the design behind.

10. **Write the decision ledger into the brain** before coding — this is the deliverable of the command:
   - Feature-scoped work → a **"Design research"** section in `.brain/features/<slug>/<slug>.md`: references (title + URL + UUID), the dominant direction, and one row per decision (`layout / type / spacing / motion / imagery / copy` → concrete choice → which reference it traces to).
   - Direction-level change → update `.brain/codebase/design-system.md` (tokens, do/don't, References) instead. Coming from `Lock status: NONE`, this is a **rewrite**, not an edit: replace the direction, pillars, component patterns, do/don'ts and reference table with this product's own, then set `Lock status` to `ACTIVE`. Leaving the starter's content in place next to your own is how a fork ends up with two directions and no lock.
   - Either way: `brain progress add --summary "design research: <surface> — locked <reference>" --next "implement <surface>"`.

11. **Map every choice onto tokens.** Before implementing, restate each visual decision in repo terms: `app/app.css` semantic variables (`--primary`, `--card`, `--text-heading`, `--border`, `--chart-{1..5}`), Tailwind 4px rhythm, `cn()` for conditionals, `font-mono uppercase tracking-wider text-xs` for tech labels, ShadCN components, `@tabler/icons-react` / `lucide-react` icons (never emoji). A reference hex that has no token gets a new semantic token via the `frontend.md` "Adding a new color" steps, or gets dropped.

12. **Build the craft, not just the structure — delegate to [`ui-builder`](../agents/ui-builder.md)**, handing it the reference lock, the one-line brief and the route. It carries the frontend rules, the craft moves, the anti-slop tells and the a11y floor, and it self-measures before returning. Its reference is [`.brain/recipes/add-premium-surface.md`](../../.brain/recipes/add-premium-surface.md) step 4 — show the product as a real panel, three surface levels, depth as four details (hairline border · 1px inner highlight · one wide soft shadow · one ambient glow), two real type faces, one accent spent sparingly, motion at the subject's real cadence, and one structural memorable move. A structurally correct page with no craft is the "passed every check and still boring" failure.

13. **Measure the mechanics before asking for an opinion**: `CI=1 bun run dev --port <free>` then `bun run design:audit -- --url <url> --scope <selector> --accent <#hex>`. Fix every HARD failure (overflow, contrast below AA, motion ignoring reduced-motion, console errors) and weigh each craft note. Hand the output to the critic in the next step so it argues about taste instead of re-deriving measurements.

14. **Then implement the remaining polish**, and finish with the browser proof required by `frontend.md`: spawn `feature-verifier` for a flow (verdict must be PASS) or a `bun run dev` walk noted in the run note for a small surface. Compare the render against the locked reference and fix actionable drift — research is not proof. End with [`/verify-done`](verify-done.md).

15. **Run the [`design-critic`](../agents/design-critic.md) sub-agent on the render — mandatory.** Screenshot the implemented surface at desktop and mobile (plus any state that matters), then spawn `design-critic` with the paths, the reference lock and the one-line brief. It judges pixels against the anti-slop checklist and the litmus tests, and it never reads the route source. **Any P0 or P1 it returns must be fixed and re-critiqued before the work is called done** — a `DO NOT SHIP` verdict is not advisory. Paste its verdict block into the verification doc.

    Ask the critic explicitly for the memorability and identity verdicts, and treat "clean checklist but forgettable" as a P1. A surface that passed every anti-slop tell was still rejected by the human reviewer as boring; the checklist only measures ways to be bad. Three questions belong in step 2's brief, not in the post-mortem: what will a viewer recall tomorrow, is this reference *appropriate* to the domain as well as distinctive, and does the subject change over time (if so, the design has a time dimension).

    The functional gates cannot catch this class of defect: typecheck, unit tests, e2e and the browser walk all pass happily on a templated page. This step is the only one that fails a design for being generic, so it is not optional and not self-assessed.

Refuse to continue past step 5 if research returned nothing usable — report that instead of inventing a direction.
