# Feature: Sample SaaS Landing (Loadline)

_Last updated: 2026-07-30_

## Purpose

A second public marketing surface at `/demo` that shows what the starter's design pipeline produces for a **product that is not this repo** — a fictional freight dispatch / carrier-ops SaaS called **Loadline**. It exists as the working proof of the two-tier design gate in [`rules/frontend.md`](../../rules/frontend.md): every visual decision on the page traces to a named Refero reference, and every one of them is expressed with the repo's existing `app/app.css` semantic tokens. Zero new colors, zero hardcoded hex.

It is explicitly labelled as a demo surface in the UI (eyebrow chip + footer) so nobody mistakes it for a real product or for a feature of the starter itself — the "Honest" pillar in [`codebase/design-system.md`](../../codebase/design-system.md).

## When It's Used

- A fork evaluates the starter and wants to see the design pipeline's output rather than read about it → `/demo`
- A `:lng`-prefixed variant (`/:lng/demo`) exists for SEO parity with `/` and `/login`
- Regression surface for the tokens-win guardrail: if someone lands a hardcoded hex or a second accent, this page is where it shows first

## Design research (tier 2 — `/design-research`, 2026-07-30)

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
