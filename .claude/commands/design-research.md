---
description: Reference-grounded design research before net-new or complex UI — Refero styles/screens/flows + ui-ux-pro-max rules → locked direction + decision ledger in the brain
---

Gate for **tier 2** frontend work (see [`.brain/rules/frontend.md`](../../.brain/rules/frontend.md) "Design intelligence"): a new surface, a redesign, a multi-step journey, or any "make this beautiful / premium" ask. Do **not** write JSX until step 7 is written down.

Skip this command for tier-1 work (another modal, another table, a spacing or a11y fix) — query `ui-ux-pro-max` inline instead.

Steps:

1. **Read the locked direction first.** `brain docs view codebase/design-system.md` + `brain docs view rules/frontend.md`. The public surface direction (Cursor + Linear, restrained/technical, single accent, mono for tech labels) is already locked. Decide and state which case you are in:
   - **Extending** the locked direction → research *within* it. Default.
   - **Re-opening** it (deliberate redesign) → say so explicitly and get the user's confirmation before continuing. This ends with a `design-system.md` rewrite in the same PR.

2. **Write the brief** (4–6 lines, in your reply): what surface, who it is for, the primary user goal, the feeling to hit, the objection to overcome, hard constraints (React Router + ShadCN + Tailwind + existing tokens, i18n via `app/locales/**`, dark mode required). Ask the user only for what would materially change the outcome; otherwise assume and proceed.

3. **Invoke the `refero-design` skill** — it owns the methodology (research before design, no single-reference copying, no averaging into a safe middle, no token-meaning changes, validate the render against the lock). Do not hand-roll the MCP calls in its place.

4. **Research all three Refero layers** (combine — never one):
   - `refero_search_styles` → `refero_get_style` on the 2–3 strongest hits. Visual language, type system, section rhythm, elevation, imagery role.
   - `refero_search_screens` (`platform: "web"`) → `refero_get_screen` / `refero_get_similar_screens` / `refero_get_screen_image`. Search by what is literally on the screen, not by adjective.
   - `refero_search_flows` → `refero_get_flow` **when the surface is multi-step** (sign-up, upload, onboarding, cancellation). Skip for single screens and say why.

   If the `refero` MCP tools are unavailable (`REFERO_MCP_TOKEN` unset), say so plainly, fall back to the skill's bundled craft references, and note the degradation in the run note. Never substitute training-data taste silently.

5. **Cross-check with `ui-ux-pro-max`** (tier 1) for the non-negotiable rules Refero does not enforce: contrast ≥ 4.5:1, 44×44 touch targets, focus rings intact, visible labels, error near field, reduced-motion, no horizontal scroll, chart legends/tooltips.
   ```bash
   python3 "${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain ux
   ```

6. **Synthesize — one dominant direction.** Pick the dominant reference and keep its sharp traits; secondary references contribute narrow details only. If two references conflict, choose, do not blend. State what is deliberately *not* being taken.

7. **Write the decision ledger into the brain** before coding — this is the deliverable of the command:
   - Feature-scoped work → a **"Design research"** section in `.brain/features/<slug>/<slug>.md`: references (title + URL + UUID), the dominant direction, and one row per decision (`layout / type / spacing / motion / imagery / copy` → concrete choice → which reference it traces to).
   - Direction-level change → update `.brain/codebase/design-system.md` (tokens, do/don't, References) instead.
   - Either way: `brain progress add --summary "design research: <surface> — locked <reference>" --next "implement <surface>"`.

8. **Map every choice onto tokens.** Before implementing, restate each visual decision in repo terms: `app/app.css` semantic variables (`--primary`, `--card`, `--text-heading`, `--border`, `--chart-{1..5}`), Tailwind 4px rhythm, `cn()` for conditionals, `font-mono uppercase tracking-wider text-xs` for tech labels, ShadCN components, `@tabler/icons-react` / `lucide-react` icons (never emoji). A reference hex that has no token gets a new semantic token via the `frontend.md` "Adding a new color" steps, or gets dropped.

9. **Then implement**, and finish with the browser proof required by `frontend.md`: spawn `feature-verifier` for a flow (verdict must be PASS) or a `bun run dev` walk noted in the run note for a small surface. Compare the render against the locked reference and fix actionable drift — research is not proof. End with [`/verify-done`](verify-done.md).

Refuse to continue past step 4 if research returned nothing usable — report that instead of inventing a direction.
