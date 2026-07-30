# Feature: Sample SaaS Landing (Loadline)

_Last updated: 2026-07-30_

## Purpose

A second public marketing surface at `/demo` that shows what the starter's design pipeline produces for a **product that is not this repo** — a fictional freight dispatch / carrier-ops SaaS called **Loadline**. It exists as the working proof of the two-tier design gate in [`rules/frontend.md`](../../rules/frontend.md): every visual decision on the page traces to a named Refero reference, and the surface runs its **own scoped design system** rather than borrowing the starter's tokens — because reusing them proved only that the guardrail works, not that the pipeline can produce a design. No literal colour appears in the route.

It took three passes to get there, and the first two are kept on the record below because the failure is more instructive than the result: see [`runs/2026-07-30-design-slop-postmortem.md`](../../runs/2026-07-30-design-slop-postmortem.md).

It is explicitly labelled as a sample surface in the UI (masthead label + sign-off note) so nobody mistakes it for a real product or for a feature of the starter itself — the "Honest" pillar in [`codebase/design-system.md`](../../codebase/design-system.md).

## When It's Used

- A fork evaluates the starter and wants to see the design pipeline's output rather than read about it → `/demo`
- A `:lng`-prefixed variant (`/:lng/demo`) exists for SEO parity with `/` and `/login`
- Regression surface for the tokens-win guardrail: if someone lands a hardcoded hex or a second accent, this page is where it shows first

## Design research — passes one and two (SUPERSEDED, kept as the record)

> **This lock no longer governs the surface.** It is the direction that shipped slop and was rebuilt; the current lock is in "Third pass" below. Read this section for what went wrong — particularly "Why Orderful over the closer-looking candidates", which is the exact reasoning the postmortem identifies as the root cause: the strongest reference was demoted for being hard to build, and the easiest one was promoted.

MCP: `refero` (`.mcp.json`). Layers used: styles → screens → flows. Tier-1 `ui-ux-pro-max` ran as the a11y/pattern cross-check only.

### Reference lock

```text
Primary: Orderful (style 9c657624-4aa8-4688-a6be-4eb3d6f2ce57) — "Precision on White Canvas"
Preserve: alternating neutral/white section bands · dark FRAMED product-UI panel as hero evidence ·
          single accent reserved for the primary CTA · hairline borders + one soft shadow ·
          comfortable density
Borrow only: default.com (8bc1389b-c2a7-41e7-937c-ca8fb53c581d) — dotted-grid hero texture, decorative role only
             Andercore (15fd028d-c493-47a9-8e69-0a59c6fdb14b) — slim utilitarian nav, measured industrial copy rhythm
Screens: Mercury transactions (33237f10 / 053e0e0e), Fingerprint events (7f13b883), Rox accounts (bcd1a669)
Flows: Mercury business onboarding (11018), Square merchant onboarding (1952)
Media: code-native dispatch board (real DOM table) — NOT fake photography
Reject: Orderful's #e42b0c + orange gradient · telegraf/Montserrat · 8px radius ·
        ui-ux-pro-max's generic "glassmorphism + trust blue" SaaS default · Ameba/Dock blue palettes ·
        Andercore's industrial photography
```

**Why Orderful over the closer-looking candidates.** Andercore (`15fd028d`) is the strongest *logistics* reference in the set — dark industrial canvas, crimson action color, trade-and-freight tone — but its visual weight is carried by desaturated photography of trucks and machinery. That asset class cannot be produced here, and faking it with CSS gradients or decorative boxes is forbidden by the `refero-design` non-negotiables. Orderful is the reference whose signature move (**product-UI evidence in a framed panel on a bright, hairline-bordered canvas**) is fully buildable as real DOM. So its rhythm is preserved and Andercore contributes only nav slimness and copy tone.

**Where the tools disagreed, and who won.** `ui-ux-pro-max --domain product` recommends "Glassmorphism + Flat Design", "Hero + Features + CTA", "Trust blue + accent contrast" for `SaaS (General)`. That is exactly the averaged default the tier-2 layer exists to override, and it loses to the reference lock. Tier 1 was used only for what it is authoritative on: focus rings, 44×44 targets, keyboard order (all three High severity).

### Decision ledger

| Decision | Source | Source rule / role preserved | Why |
|---|---|---|---|
| Page rhythm: alternating `bg-background` / `bg-muted/40` full-width bands | Orderful (primary) | "Content sections alternate between subtle gray bands and crisp white, creating a predictable vertical rhythm" | Gives a 6-section page structure without adding a third surface level, which `design-system.md` forbids |
| Hero = copy left, **dark framed dispatch board** right | Orderful (primary) | "Hero features a prominent headline to the left, paired with a dark-themed product UI visual on the right" — imagery role: product evidence, not atmosphere | The one memorable move. An ops lead believes a board with lanes, ETAs and check-call ages; they don't believe a stock photo |
| Board frame = inverted surface (`bg-foreground` / `text-background`) | Orderful (primary) | "Card - Elevated: Deep Shadow #1f1f1f … used for visually distinct sections" — role: surface inversion for hierarchy | Token-honest way to get Orderful's dark frame. Inverts correctly in dark mode instead of pinning a literal dark hex |
| Status = dot **plus** text label; `rolling` neutral, `late` → `--destructive`, `delivered` → `--chart-2` | Screens layer (Mercury, Rox) + `ui-ux-pro-max --domain ux` + `design-system.md` "color rare" pillar | Compact rows with colored status badges; "don't rely on color alone to convey meaning"; role of `--destructive` preserved as alarm | First pass mapped all three statuses onto chart tokens. Corrected during implementation: the majority state earns no color at all, so the two states a dispatcher must spot keep their signal value |
| Pill filter row above the board (`All 42 · Rolling 18 · Late 3`) | Screens layer (Mercury transactions, Rox accounts) | "pill filters above the table", "muted meta labels" | Signals a real working surface. Static in the demo — labelled as demo data, not wired to state |
| Dotted-grid texture behind the hero | default.com (borrowed) | Hero "over a subtle dotted grid background, creating an engineered feel" — decorative role only | Built as `radial-gradient(var(--border) 1px, transparent 1px)`, so it inherits the token and inverts with the theme. Never used as an interface surface |
| Slim top bar, wordmark + mono product chip, one primary CTA | Andercore (borrowed) + Orderful | "Navigation is slim and utilitarian" / "sticky top bar with a clear primary action" | Matches the repo's existing top bar so the demo reads as part of the same system |
| Single accent = `--primary`, CTA only | Orderful (primary) + `design-system.md` | "Utilize Action Blaze exclusively for primary calls-to-action" — role: CTA-only | Same role, repo's token. Orderful's actual orange-red is rejected: this repo has one monochrome accent |
| Radius `rounded-md` (6px), one `shadow-sm` + hover lift | `design-system.md` beats Orderful's 8px | Orderful's "consistent 8px radius" trait deliberately dropped | Repo lock wins on shape language; keeping 8px here would fork the system for one page |
| Type: Inter, `text-5xl sm:text-6xl font-semibold tracking-tight` display | `design-system.md` beats Orderful's telegraf | Orderful's tight negative letter-spacing kept via `tracking-tight` | Only the *trait* (tight, precise display type) survives; the typeface does not |
| Copy: named ops pains, no pricing table, no FAQ | Screens layer + Andercore tone | Avoids the generic hero → features → pricing → FAQ → CTA order | The objection is "we already do this on spreadsheets and phone calls", so the page answers with the day's cost, not with tiers |
| "What happens next" 3-step strip instead of a fake signup wizard | Flows layer (Mercury 11018, Square 1952) | Marketing landing → create account → credentials → onboarding checklist | Both reference flows front-load a single "get started" and show progress. The strip previews that sequence honestly without shipping a fake funnel |
| Friction-reducer line under the CTAs | Flows layer | "no credit card required"-class reassurance at the entry point | Directly answers the migration-risk objection at the moment of the click |

## Fourth pass — "Guide Sign" (CURRENT)

**Why there was a fourth.** Pass three (Waybill) passed the whole anti-slop checklist and the human verdict was still "lame and boring as hell". The critic had said the same thing more politely: the visual system "transfers to any data-heavy B2B product without changing one rule", and "the bottom 47% of the page is still forgettable". The lesson is in [`runs/2026-07-30-design-slop-postmortem.md`](../../runs/2026-07-30-design-slop-postmortem.md#the-anti-slop-checklist-is-a-floor): **passing the checklist is not the objective.** Removing every way to be bad — no cards, no hue, one weight, no radius — removes every reason to look, too. Two further errors: an archival architecture portfolio is the wrong reference for a product about trucks going dark at 3am (distinctive ≠ appropriate), and the page was *static* for a product whose entire nature is that it moves.

### Reference lock (current)

```text
Primary: EVOKE (refero 1e802d79) — "vibrant billboard clarity"
Preserve: oversized type on saturated flat panels · full-bleed sections · 0px radius ·
          no gradients, no soft edges · type is the show
Borrowed: incident.io (3fcc8a86) — one vivid accent belongs to genuine urgency, nothing else
Palette: the MUTCD — the actual US highway signage specification, not a taste choice
          #046A38 guide-sign green   destination panels, CTAs
          #FFFFFF reflective white   sign type + the inset sign border
          #FF6A13 safety orange      HAZARD ONLY — the load that has gone dark
          #FFCC00 warning yellow     the cost-of-a-shift panels
          #101010 asphalt            body type, 2px road-marking rules
Idea: dispatch is the road. Signage exists to tell someone with three seconds where they are
      going and what is wrong — the dispatcher's problem exactly.
Motion: the dark load's minutes climb once a minute (the real cadence, not a fake ticker); the
      hazard triangle pulses. Both stop under prefers-reduced-motion.
Reject: cards · dark canvas · any hue outside the MUTCD set · accent used decoratively ·
      heading+subtitle+grid-of-three · rounded corners · gradients · a still page
```

### The move

`LL-4818` is one object rendered three ways down the page — exit tab and destination sign at the top, orange hazard placard bolted under it, then the same load as the single orange row inside an otherwise black-on-white board. The critic's words: *"that is a structural idea rather than volume"*, and it is what carries the board section past "transfers to any data-heavy B2B product".

Signage solutions used as design solutions, not compromises: lanes abbreviate to `LRD → MEM` below `sm` and the constant `LL-` prefix drops, because abbreviating for limited space at speed is what signs do — which is also what made five columns fit a 390px viewport.

### Critic verdict (`design-critic`, 4th pass)

`DO NOT SHIP` → P1 fixed (the abbreviated lane was breaking across three lines on mobile with the arrow orphaned, defeating the lock's own named mobile move). Substantive P2s fixed in the same pass: the hero figure now sits in a distance field closed by a reflective rule with a directional arrow (it was "an infographic figure on a green ground"); the value claims are no longer the quietest text on the page; the steps band got the signage system instead of staying in the rejected direction; mobile yellow area reduced so the warning hue no longer outweighs the hazard.

Measured on the render: palette is exactly the five MUTCD values plus one secondary gray, zero gradients, zero radii; orange appears in exactly two regions per viewport; contrast — white on green 6.72:1, asphalt on orange 6.64:1, asphalt on yellow 12.59:1, origin legend on green 4.90:1, secondary gray on white 6.72:1. All clear AA.

Open, recorded, not blocking: the closing band and the cost band are still two consecutive three-item groups (different paint, same closing rhythm), and the positioning line "One board for every load, every check-call, every invoice" is the one category-agnostic sentence on the page.

## Third pass — Waybill (SUPERSEDED)

**The first two passes were both wrong, in different ways.** Pass one reused the starter's tokens, so the surface looked like the starter. Pass two gave it Andercore's tokens, which changed the colour but left the *composition* untouched — and the composition was the generic stack: hero with copy left and a product panel right, then six identical heading → subtitle → grid-of-three bands, with cards as the default container. Scored against the `refero-design` skill's own `references/anti-ai-slop.md` (a file the process never required anyone to open) it failed six checks. Full postmortem, including the three structural holes that let it through: [`runs/2026-07-30-design-slop-postmortem.md`](../../runs/2026-07-30-design-slop-postmortem.md).

### Reference lock (superseded by Guide Sign)

```text
Primary: 19–86 (7a8c99db) — "architectural blueprint on white marble"
Preserve: pure black on pure white, achromatic only (Ash Gray for secondary) ·
          1px solid black rules as THE structural device ·
          ONE family, ONE weight (400) at every size — scale without weight ·
          tabular/list structure as the page's layout, full-bleed, no max-width container ·
          zero radius, zero shadow, zero gradient · -0.02em tracking
Borrow only: mono.frm.fm (4b3c372c) — condensed uppercase micro-labels, wide tracking
Media: none required. The reference has no imagery; text is the carrier, so nothing is faked.
Reject: cards · dark canvas · any hue · hero-left/product-right · one-word colour highlight ·
        heading+subtitle+grid-of-three bands · shadows · rounded corners · weights above 400
```

**Why this reference.** Freight runs on documents — bills of lading, rate confirmations, manifests. A system built from hairline rules, tabular alignment and monumental light-weight type is the visual language of the artefact the product replaces. It is also the direction the user chose from three offered, which is the skill's own workflow for a landing page and a step the earlier passes skipped.

### Composition — the part that changed

| Section | What it is | Why it is not the default |
|---|---|---|
| Masthead | Wordmark, ruled links, locale switch | One rule, nothing competing. No sticky blurred bar. |
| **Monument** | A 352px figure — *214, minutes since LL-4818 last checked in* — in the same weight as body copy | The page opens on the number that costs money, not on a screenshot of the app. Scale without weight is the reference's signature. |
| **Manifest** | Full-bleed hairline-ruled table of tonight's loads | The product's working surface *is* the page. Not a framed panel beside the copy. |
| Annotations | Three marketing lines rendered **inside** the table, on the rows that prove them | This is why there is no feature section. The claim sits next to its evidence. |
| Ledger | Three figures as ruled columns split by hairline verticals | The same content that used to be three cards, with the cards removed. |
| Sequence | Numbered ruled rows in the manifest's own column language | Not a three-card "how it works". |
| Sign-off | Statement, CTA repeated once, honesty note | No newsletter, no fake pricing, no FAQ. |

### Two removals worth recording

- **`LanguageSwitcher` and `ThemeToggle` are gone from this surface.** They dragged in a shadow, a radius and `font-weight: 500` — three traits the lock forbids — and a theme toggle on a surface that pins itself light is dishonest UI. Locale switching is two ruled text buttons posting to the same `/api/set-locale` action, so cookie + revalidation behaviour is unchanged.
- **`boardFilters` was deleted**, not left dangling, when the pill row went.

### Automated slop probe (counts, not opinions)

Measured in-browser on the render: **0** chromatic elements · **0** radii above zero · **0** shadows · **0** font weights above 400 · **58** hairline rules · monument at 352px · no horizontal page scroll at 390px · no JS or network errors.

## The scoped design system (superseded values — technique unchanged)

The scoping **technique** below still stands and is now a documented convention (`rules/frontend.md` "Scoped design systems"); only the values changed when the direction did. `app/routes/demo/loadline-theme.css` now carries the Waybill palette (white paper, black ink, Ash Gray secondary, `--radius: 0`). The Andercore table that follows is kept as the worked example of the technique and as the record of what pass two committed to.

Direction: **Andercore** (`15fd028d`) — "dark control panel, sharp red accent" — the logistics reference originally rejected as *primary* because its photography is unbuildable here. Its **token system** is buildable, so it owns colour, shape and density while Orderful keeps owning structure (band rhythm, framed product panel, alternating feature rows). Each source has a bounded job; neither was averaged into the other.

| Token | Value | Source role |
|---|---|---|
| `--background` | `oklch(0.121 0.017 7.8)` | Midnight Void `#0b0405` — page canvas |
| `--card` | `oklch(0.173 0.012 8.8)` | Dark Shroud `#150e0f` — raised surface (board frame, cards) |
| `--border` / `--input` | `oklch(0.313 0.015 4.4)` | Ghostly Gray `#382e30` — all separation; reference forbids shadows |
| `--foreground` | `oklch(1 0 0)` | Pure White — primary text |
| `--muted-foreground` | `oklch(0.607 0.005 0.1)` | Slate Text `#858182` — labels, secondary copy |
| `--primary` / `--ring` | `oklch(0.592 0.219 24.2)` | Crimson Action `#e32735` — **CTA only** |
| `--destructive` | `oklch(0.592 0.219 24.2)` | same crimson, in the reference's sanctioned "urgent highlight" role (the late dot) |
| `--chart-1…5` | achromatic white → slate | reference bans additional saturated hues, so status is encoded by lightness + text label |
| `--radius` | `0.375rem` | so ShadCN's `rounded-md` (`--radius - 2px`) lands on the reference's 4px; containers use `rounded-none` for its 0px |

**Why this works with zero component edits.** `app/app.css` maps `@theme inline { --color-*: var(--*) }`, so utilities resolve through variables at use time. Redefining the same names inside the scope restyles untouched ShadCN components: the `Button` renders crimson at 4px radius without a single prop change.

**Deviations from repo norms, each with its source rule:**

1. **Dark in both app themes.** The reference's own do/don't list says "avoid light backgrounds; … light themes will contradict the brand's atmosphere." Honouring a lock means honouring that, so the scope re-asserts its values under `.dark` and opts out of the toggle. The toggle still works everywhere else.
2. **Square containers, 4px controls** instead of the starter's uniform 6px `rounded-md`.
3. **Inter retained** — the reference names Inter as Archivo's substitute, so no webfont and no external request; the surviving trait is its `-0.02em` tracking, applied on the scope.

**Accent discipline was audited in the browser, not assumed.** A first render leaked crimson onto the active filter pill, the feature-list bullets and the step numerals. After the fix, crimson paints exactly six elements: three CTAs, the eyebrow brand dot, the late-status dot, and the single hero accent word.

**Non-leakage is verified, not asserted:** loading `/` in the same session shows root `--background: oklch(1 0 0)`, `--primary: oklch(0.205 0 0)`, `--radius: 0.625rem` and zero `[data-surface]` elements.

## How It Works

Static presentational route — no loader data, no tRPC, no DB. All copy comes from the `demo` i18n namespace (`en` + `zh`); the board rows are a module-level constant of demo data whose labels are i18n keys.

The route is public and does **not** call `redirectIfAuthenticated` (unlike `/`) — a signed-in user following the link should still see the surface rather than being bounced to `/dashboard`.

### Testability

- Unit: `app/routes/demo/__tests__/board-data.test.ts` pins the demo board dataset's invariants (status values are token-mapped, the filter counts match the rows).
- Browser: `feature-verifier` walk → `.brain/features/sample-saas-landing/verifications/<date>.md` (golden path + dark mode + `zh` locale + keyboard focus order).
- No committed e2e spec: the page is static marketing, so the CI smoke net (`/` + `/login`) already covers the render path this route uses.

## Key Files

| File | Role |
|------|------|
| `app/routes/demo/_index.tsx` | The surface — top bar, hero + dispatch board, 4 content bands, footer |
| `app/routes/demo/board-data.ts` | Demo dispatch rows + filter counts + status → token map |
| `app/routes/demo/__tests__/board-data.test.ts` | Unit tests for the dataset invariants |
| `app/locales/{en,zh}/demo.json` | All copy |
| `app/i18n/i18n.ts` | `demo` added to `namespaces` |
| `app/i18n/i18n.d.ts` | `demo` added to the typed resources |
| `app/routes.ts` | `/demo` + `/:lng/demo` |

## Dependencies

- UI primitives: `Button`, `Card`, `StackBadge`, `ThemeToggle`, `LanguageSwitcher`
- Icons: `@tabler/icons-react`
- i18n: `react-i18next` via the `demo` namespace
- No Effect services, no CF bindings, no tagged errors — nothing server-side to fail

## Tagged Errors

None. The route has no loader, no mutation and no external call.

## Verification

[`verifications/2026-07-30.md`](verifications/2026-07-30.md) — ✅ PASS. 7-step browser walk (light, dark, `zh`, keyboard, mobile, CTA navigation) with measured contrast on four critical pairs; zero JS and network errors.

Two defects the walk caught and this change fixes:

1. **Horizontal page overflow at 390px** — the top bar's control cluster (wordmark + chip + sign-in + CTA + language switcher + theme toggle) measured 323px wide, pushing the page to `scrollWidth 491`. Chip and sign-in link now drop below `sm`. `min-w-0` added to the board frame + scroll container so the table's `min-w-[34rem]` can never escape its grid track.
2. **Status colour spent on the wrong states** — see the ledger row above.

One pre-existing repo gap surfaced and deliberately left alone: **`/zh/demo` does not switch locale**, because `i18nServer.getLocale` reads `?lng`, the cookie and `Accept-Language` but never the `:lng` path param. `/zh/` on the existing home route behaves identically, so it is a repo-wide i18n-detection gap rather than anything this surface introduced. Fixing it touches locale detection for every route and belongs in its own task.

## Open Questions / Risks

- The page is industry-specific demo content in a general-purpose template. If it starts to read as noise for forks, delete the route + namespace + locale files — it has no other consumers.
- Board data is static. If it ever becomes loader-driven, the honesty label in the footer needs to change with it.
