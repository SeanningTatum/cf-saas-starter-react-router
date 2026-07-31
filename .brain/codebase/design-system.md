# Design System — Boilerplate Surface

> **Lock status — derive it, never assume it.** `ACTIVE` while `package.json` `name` is `cf-saas-starter-react-router`; **`NONE` under any other name**. One `grep` answers it:
>
> ```bash
> grep -q '"name": "cf-saas-starter-react-router"' package.json && echo ACTIVE || echo NONE
> ```
>
> Read [Lock status](#lock-status) before treating anything below as binding.

> Visual language for the **public marketing surface** (home, login/sign-up, dashboard entry). Synthesized from refero `DESIGN.md` references for [Cursor](https://styles.refero.design/style/4e3b4717-84c8-4599-baaf-a343c3d619b6) and [Linear](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) — both target a developer audience and read as "credible, technical, polished."
>
> **This is the surface design language.** Internal app surfaces (admin, dashboard sub-pages) should reuse the same tokens but lean denser/more utilitarian. ShadCN component defaults still apply unless overridden here.

## Lock status

This repo is a **template**. Apps are created from it (`/new-app`), which copies `.brain/` wholesale — so this file travels into products that have nothing to do with a developer-tooling boilerplate. The lock has to travel with a status, or every fork inherits Linear's palette for a product about restaurants.

The status is **derived, not written down**, because a hardcoded word is exactly what a wholesale copy carries across unchanged. The discriminator is `package.json` `name`: the starter is `cf-saas-starter-react-router`, and `bun setup` rewrites that field to the new app's name on first run ([`scripts/first-time-setup.ts`](../../scripts/first-time-setup.ts), `updatePackageJsonName`). A fork therefore reads `NONE` without anyone remembering to flip anything.

| Status | Means | Derived when |
|---|---|---|
| `ACTIVE` | The direction below is **binding**. Extending a surface = research *within* it. Only a deliberate redesign re-opens it, and that redesign updates this file in the same PR. | `package.json` `name` is `cf-saas-starter-react-router` — i.e. this repo, the starter itself. |
| `NONE` | **No direction is locked.** Everything below is a *worked example* of how to record one, not a direction to build toward. The first tier-2 surface must run [`/design-research`](../../.claude/commands/design-research.md) and rewrite this file with its own direction, references and do/don'ts — which also replaces this derivation with that app's own `ACTIVE` statement. | Any other `name` — an app created from the starter, before it has done its own design research. |

Edge case worth naming: an app that forked the starter but never ran `bun setup` still carries the starter's package name and will derive `ACTIVE` wrongly. If you know you are in a forked product, `NONE` is the answer regardless of what the `grep` says — the repo name, the README and the `## Overview` in `AGENTS.md` all settle it faster than the heuristic does.

**If the status line above says `NONE`, stop treating the rest of this file as a spec.** The pillars, the Cursor/Linear reference lock, the stack badges, the "don't reintroduce the orange→yellow gradient" note — all of it describes the starter's own landing page. Read it for the *shape* of a design record (direction → tokens → components → do/don't → locked references), then replace the content.

What stays true in either status, because it is repo convention rather than visual direction: semantic tokens in `app/app.css` win over any tool's raw hex, `cn()` for conditional classes, `data-testid` on interactive elements, copy in `app/locales/en/*.json`. Those live in [`../rules/frontend.md`](../rules/frontend.md) and are not part of the lock.

## Direction

A boilerplate that says, in one glance: _serious tech stack, low-noise UI, no marketing slop_. The audience is engineers evaluating whether to fork the repo. They don't want aspirational hero copy — they want to see the wiring.

| Pillar | What it means concretely |
|---|---|
| **Restrained** | One accent color (CTA only). Monochrome surface palette. No gradients on text except as deliberate accent on a single hero word. |
| **Technical** | Mono font for stack badges, route paths, file references, code-like UI strings. |
| **Generous spacing** | 4px base unit; minimum vertical rhythm of 16/24/32/48 between sections. |
| **Educational** | Every page surfaces _what's wired_ — stack badges, "powered by" rails, links into source/brain docs. |
| **Honest** | Dashboard cards link to features that actually exist; remove placeholder/random-user clutter. |

## Tokens

Reuse existing `app/app.css` semantic tokens (`--background`, `--foreground`, `--card`, `--primary`, `--muted-foreground`, `--border`, etc.). **Do not introduce a new color palette** — the existing oklch monochrome works for the Linear/Cursor direction.

### Spacing scale (Linear-inspired, 4px unit)

Use Tailwind's default scale (`1`=4px, `2`=8px, `3`=12px, …). Layout rhythm:

| Use | Tailwind |
|---|---|
| Tight inline gap (icon ↔ label) | `gap-2` (8px) |
| Card padding | `p-6` (24px) |
| Section vertical rhythm (within page) | `space-y-12` / `gap-12` (48px) |
| Hero block top/bottom | `py-20` / `py-24` (80–96px) |
| Container max-width (marketing) | `max-w-6xl mx-auto` |
| Container max-width (auth + dashboard) | `max-w-5xl mx-auto` |

### Radius

Match Linear's restraint: `rounded-md` (6px) for cards/buttons/inputs, `rounded-full` only for badges/avatars. Avoid `rounded-2xl` and above on functional surfaces.

### Elevation

Use a single subtle shadow on elevated cards (`shadow-sm`) and a hover lift (`hover:shadow-md transition-shadow`). Do not stack multiple shadows. The page background does not nest more than two surface levels (`bg-background` → `bg-card`).

### Typography

Inter (already wired via `--font-sans`) covers everything. Add a **mono** family for stack badges and code-like surfaces — use the system stack already common in this codebase: `ui-monospace, SFMono-Regular, Menlo, monospace`. We can reference it via `font-mono` (Tailwind default).

| Role | Class | Notes |
|---|---|---|
| Display (hero) | `text-5xl sm:text-6xl font-semibold tracking-tight` | Drop the `font-extrabold`; `semibold` reads more refined. |
| H1 (page) | `text-3xl font-semibold tracking-tight` | |
| H2 (section) | `text-xl font-semibold tracking-tight` | |
| Body | `text-base text-muted-foreground` | Default; `text-foreground` only when emphasis matters. |
| Caption / meta | `text-sm text-muted-foreground` | |
| Stack badge / code-ish | `font-mono text-xs uppercase tracking-wide` | |

### Accent

Single accent: existing `--primary` (oklch dark in light mode, oklch light in dark mode — i.e., it's monochrome by design). Use it for:

- Primary CTA button background
- Active-link underline
- Single-word hero highlight (`text-primary` instead of orange→yellow gradient)

The orange→yellow gradient currently in `home.tsx` should go. It dates the page and conflicts with "restrained / technical."

## Components — surface patterns

### Stack badge (new pattern)

A small, monospace, uppercase label with a subtle border that names a piece of the stack ("WORKERS", "tRPC", "DRIZZLE"). Used in hero callouts, login context panel, dashboard feature cards.

```tsx
<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
  <span className="size-1.5 rounded-full bg-primary" />
  Workers
</span>
```

### Educational feature card

A card that explains what's wired, links to the live feature, and shows the relevant stack badges. Used on home + dashboard.

```tsx
<Link to="/admin" className="group">
  <Card className="h-full transition-shadow hover:shadow-md">
    <CardHeader>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <StackBadge>tRPC</StackBadge>
        <StackBadge>Drizzle</StackBadge>
      </div>
      <CardTitle className="text-base">Admin dashboard</CardTitle>
      <CardDescription>
        Role-gated /admin route, user management, analytics.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-1.5 transition-all">
        View admin → 
      </span>
    </CardContent>
  </Card>
</Link>
```

### Auth split-pane

Login + sign-up: form on left (current width `max-w-sm`), context panel on right at `md:` and up. Context panel shows what the auth system is (Better Auth + D1) and a few stack badges. Mobile collapses to single column (form only — context drops).

## Page-specific direction

### Home (`/`)

Replace current "showcase + random-user button + raw user list" page with:

1. **Top bar** — small wordmark left, theme toggle + GitHub link right.
2. **Hero** — H1 + one-line description + two CTAs ("Sign up", "Sign in"). Stack badges row beneath ("Workers · React Router · tRPC · Better Auth · Drizzle · Effect TS").
3. **What's wired** — 6 educational cards (Auth, Admin, File Upload, Analytics, i18n, Effect TS). Each links to the most relevant route or brain doc.
4. **Try it** — small inline panel: "Sign up with a random email" button (the existing demo, but reframed and isolated, not the centerpiece).
5. **Footer** — repo link, brain link, "Built on the [stack]" line.

Drop entirely:
- The raw `UserList` rendering (it's a debug surface, not marketing).
- The orange→yellow gradient.
- The `🔐` `✨` emoji card icons (replaced with Tabler/Lucide icons).

### Login + Sign-up

Wrap the existing form in a split-pane layout:

- Left (sm: only column, md: 5/12 col): form card (essentially today's `LoginForm`), with a tightened header and a small "← back to home" link top-left of the page.
- Right (md: 7/12 col): context panel with a single h2, a short paragraph explaining what the auth system is, and a vertical list of stack badges. Hides on `<md`.

### Dashboard entry (`/dashboard`)

Replace the three placeholder cards (Getting Started, Recent Activity, Quick Actions — none of which actually do anything) with **four real boilerplate orientation cards**:

| Card | Links to | Icon | Badges |
|---|---|---|---|
| Auth & session | docs section / `/admin/users` | `IconLock` | Better Auth, D1 |
| Admin dashboard | `/admin` (admin-only) | `IconShield` | tRPC, Drizzle |
| File upload | brain doc | `IconUpload` | R2, Workers |
| Effect TS API | brain doc | `IconCode` | Effect, tRPC |

Welcome row keeps `Welcome back, {name}!` but adds a one-line subtitle that points at "what to explore first."

## Do / Don't

### Do
- Reuse `--primary` for the single accent. Let dark mode invert it as it does today.
- Use `font-mono` + `uppercase tracking-wider text-xs` for any stack/tech label.
- Use `cn()` for every conditional class.
- Add `data-testid` on every interactive element (per `frontend.md`).
- Keep all copy in `app/locales/en/*.json`.

### Don't
- Don't reintroduce the orange→yellow text gradient.
- Don't hardcode hex/rgb in JSX (per `frontend.md`).
- Don't add a third surface level (no nested cards).
- Don't write copy that promises features that don't exist (no "Recent Activity" placeholder).
- Don't add new colors or radius tokens to `app.css` for this pass — reuse existing.
- Don't put emojis in the UI.

## A surface with its own design system

This document governs the **starter's** surfaces. A surface that markets a different product (or a white-label skin) may run its own visual language through a **scoped token override** — same variable names, new values, under a `[data-surface="…"]` selector, in a stylesheet next to its route. Rules and the non-leakage requirement: [`../rules/frontend.md`](../rules/frontend.md) "Scoped design systems".

Worked example: the `/demo` surface (removed before merge — see [`features/sample-saas-landing/sample-saas-landing.md`](../features/sample-saas-landing/sample-saas-landing.md)) ran a complete dark product-page system of its own — its own canvas, panels, accent, type pairing and radius scale — while `/` and every other route kept the tokens above, verified unchanged in the same browser session and pinned by an e2e test in both directions. The technique and its rules are in [`../rules/frontend.md`](../rules/frontend.md) "Scoped design systems"; the recipe that uses it is [`../recipes/add-premium-surface.md`](../recipes/add-premium-surface.md).

## Re-running the research

This direction came from Refero. To extend it (new marketing section, new surface) or re-open it (deliberate redesign), run [`/design-research`](../../.claude/commands/design-research.md) — it drives the `refero-design` skill across the three Refero layers (styles → screens → flows), cross-checks a11y with `ui-ux-pro-max`, and writes a decision ledger before any JSX. Requires the `refero` MCP server ([`.mcp.json`](../../.mcp.json), `REFERO_MCP_TOKEN`).

Locked reference set for this surface — **only while `Lock status` is `ACTIVE`**. Pass these UUIDs to `refero_get_style` rather than re-searching from scratch. Under `NONE` they are the starter's references, not yours: read them as an example of what a reference lock records (source + traits taken), then search Refero for your own product's world.

| Reference | Style UUID | Traits taken |
|---|---|---|
| Cursor | `4e3b4717-84c8-4599-baaf-a343c3d619b6` | Warm light surface, mono accents, multi-layer shadow, deliberate type |
| Linear | `90ce5883-bb24-4466-93f7-801cd617b0d1` | 4px spacing unit, 6px radius, dense type, restrained palette |

Adjacent references worth studying for a *technical, monochrome, dev-audience* surface (dominant-direction candidates — do not blend them): `ui.shadcn.com` `c14c0a94-1037-449e-bf5b-4cb972656ac7` (component-showcase grid, typographic authority), `sst.dev` `7b6c53c7-7145-476e-aed8-f2367eef3adb` (code block as the hero motif), `linear.app/changelog` `11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6` (dark restrained changelog rhythm).

## References

- `ui-ux-pro-max` skill — offline design-rule database (styles, layouts, UX/a11y checks, chart rules) queried before net-new UI. Advisory on **structure and behavior only**; the tokens above win on color/type. Invocation + guardrail: [`../rules/frontend.md`](../rules/frontend.md) "Design intelligence".
- Refero MCP + `refero-design` skill — reference research for complex/net-new surfaces (tier 2 in `frontend.md`). Same guardrail: structure and behavior, never raw color.
- Refero — Cursor `DESIGN.md` (warm light, mono-accented, multi-layer shadow, deliberate type).
- Refero — Linear `DESIGN.md` (4px spacing unit, 6px radius, dense type, restrained palette).
- `.brain/rules/frontend.md` — repo-wide frontend conventions (Tailwind tokens, `cn`, ShadCN forms, `data-testid`).
