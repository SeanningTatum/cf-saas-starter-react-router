# Frontend Layer

UI components, forms, modals, styling. **Source-of-truth files**: `app/components/**`, `app/routes/**/*.tsx`, `app/app.css`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md).
> Public marketing surface (home, login/sign-up, dashboard entry) has its own visual language: see [`../codebase/design-system.md`](../codebase/design-system.md).

## Forms

**ShadCN Form + React Hook Form + Effect Schema via `effectResolver`. No Zod.**

```typescript
import { useForm } from "react-hook-form";
import { effectResolver } from "@/lib/effect-form";
import { CreateWidgetInput } from "@/lib/schemas/widget";

const form = useForm<typeof CreateWidgetInput.Type>({
  resolver: effectResolver(CreateWidgetInput),
});
```

Use ShadCN's `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormControl>`, `<FormMessage>` from `app/components/ui/form.tsx`. Follow existing forms (`sign-in.tsx`, `sign-up.tsx`) for canonical layout.

**Anti-patterns:** `zodResolver(...)`, raw `<input>` without `<FormField>`, manual schema validation in `onSubmit`.

## Modals

Naming: `{feature}-modal.tsx` in `app/components/`. Use ShadCN `Dialog`. Wire mutations via tRPC + cache invalidation.

```typescript
interface FeatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  entityId?: string;
  mode?: "create" | "edit";
}

export function FeatureModal({ open, onOpenChange, entityId, onSuccess }: FeatureModalProps) {
  const utils = api.useUtils();
  const { data, isLoading } = api.widget.get.useQuery({ entityId }, { enabled: open && !!entityId });
  const mutation = api.widget.save.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      utils.widget.get.invalidate();
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => toast.error(error.message ?? "Failed to save"),
  });
  // form state, useEffect to populate on data load, useEffect to reset on close
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="feature-modal">
        <DialogHeader><DialogTitle>Title</DialogTitle></DialogHeader>
        {isLoading ? <Loader2 className="size-6 animate-spin" /> : <>{/* fields */}</>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="size-4 animate-spin mr-2" />Saving...</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Rules:
- `data-testid` on modal root + key buttons/fields
- Reset form state in `useEffect(() => { if (!open) reset(); }, [open])`
- Disable Cancel + Save during `mutation.isPending`
- `mode: "create" | "edit"` for multi-purpose modals

## Tailwind / CSS variables

**Never hardcode hex/rgb/oklch in JSX.** Use semantic CSS variables from `app/app.css`. They auto-switch in dark mode.

| Instead of | Use |
|------------|-----|
| `bg-white` | `bg-background` / `bg-card` |
| `text-gray-900` | `text-foreground` / `text-text-heading` |
| `text-gray-600` | `text-muted-foreground` / `text-text-body` |
| `bg-blue-600` | `bg-primary` |
| `border-gray-200` | `border-border` |
| `bg-red-500` | `bg-destructive` |

Available semantic vars: `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary(-foreground)`, `--secondary(-foreground)`, `--muted(-foreground)`, `--accent(-foreground)`, `--destructive`, `--border`, `--input`, `--ring`, `--text-heading`, `--text-body`, `--text-body-subtle`. Brand scale: `bg-brand-{50..950}`. Sidebar: `--sidebar*`. Charts: `--chart-{1..5}`.

**Adding a new color:**
1. Pick semantic name (`--success`, never `--green`)
2. Add `:root { --success: oklch(...); --success-foreground: oklch(...); }` in `app/app.css`
3. Add same in `.dark { ... }` block
4. Register in `@theme inline { --color-success: var(--success); ... }`
5. Use as `bg-success text-success-foreground`

**Always use `cn()` from `@/lib/utils` for conditional classes.** Never template literals or string concat.

```tsx
// good
<div className={cn("p-4", isActive && "bg-primary", className)}>

// bad
<div className={`p-4 ${isActive ? "bg-primary" : ""}`}>
```

Exception: gray scale OK for subtle layout (`border-gray-200 dark:border-gray-800`).

## Components

- ShadCN-based, in `app/components/ui/`. Add new: `bunx shadcn@latest add [name]`.
- Icons: `@tabler/icons-react`, `lucide-react`.
- After mutations, invalidate via `api.useUtils()`.
- `data-testid` on every interactive element used in e2e tests.

### Shared components / patterns (2026-07-15 remediation)

- **`FeatureCard`** (`app/components/feature-card.tsx`) — the linked icon/title/badges/CTA card used by both `home.tsx` and `dashboard/_index.tsx` (optional `disabled`/`disabledHint`). Don't re-roll per-route card components.
- **Loader auth gating** — use `requireSession` / `requireAdmin` / `redirectIfAuthenticated` from `app/lib/session.ts`, never inline `context.auth.api.getSession` + redirect branching (see `routes.md`).
- **Admin client actions** — route `authClient.admin.*` calls through the `runAdminAction` helper in `user-data-table.tsx` (checks `response.error`, toasts, revalidates). Never toast success before checking the response.
- **Theme switcher** — one source: `themeItems` exported from `app/components/theme-toggle.tsx` (values double as `common.theme.*` i18n key suffixes; translate at the render site).
- **Avatar initials** — `getInitials` from `@/lib/utils`, not per-component copies.
- **Dates** — always through `app/lib/date-utils.ts` `formatDate` + `useTranslation().i18n.language`; never raw `toLocaleDateString("en-US", ...)` (breaks `zh`).

## Design intelligence — never design from training-data taste

Two tools, two jobs. Pick by **how much visual invention the task needs**, and run [`/design-research`](../../.claude/commands/design-research.md) for anything in tier 2.

| Task | Tool | Why |
|------|------|-----|
| Reusing existing patterns — another modal, another table, another form, a spacing/a11y fix, a chart | **`ui-ux-pro-max`** (tier 1, default) | Offline rule lookup. Cheap, no network. Answers "what is the correct pattern here". |
| Net-new surface with real visual ambition — a new marketing/landing section, a new product surface, a redesign, a multi-step journey, "make this beautiful/premium" | **Refero MCP + `refero-design` skill** (tier 2) | Real-product references. Answers "what should this *feel* like" with named evidence instead of averaged AI taste. |
| Anything touching color, type, radius, elevation | [`../codebase/design-system.md`](../codebase/design-system.md) + `app/app.css` tokens | Committed visual language. **Wins over both tools.** |

### Tier 1 — `ui-ux-pro-max`

Installed as a plugin skill (`ui-ux-pro-max@ui-ux-pro-max-skill`, enabled in [`.claude/settings.json`](../../.claude/settings.json)) — Claude Code loads it automatically via the `ui-ux-pro-max` Skill; other tools invoke the script directly.

```bash
# stack for this repo is always react + tailwind + shadcn
python3 "$UUPM/scripts/search.py" "<query>" --domain <style|color|typography|ux|chart|product|gsap|icon>
python3 "$UUPM/scripts/search.py" "<query>" --stack shadcn      # component-level guidance
# $UUPM = ${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max (plugin-provided env var)
```

**What to take from it:**

| Take | Ignore |
|------|--------|
| UX / accessibility rules (contrast, 44×44 touch targets, focus rings, labels, reduced-motion) | Its raw hex palettes — see guardrail below |
| Layout + responsive patterns, grid/spacing structure, navigation patterns | Its font recommendations when they conflict with `design-system.md` |
| Chart type + legend/tooltip rules (feed `--chart-{1..5}`) | `--persist` / `--design-system` scaffolding — this project already has a design system |
| Form / feedback / empty-state / loading patterns | Style categories that fight the "restrained, technical" direction |

### Tier 2 — Refero MCP (complex / net-new visual work)

For anything where the answer is a *look*, not a rule. Server declared in [`.mcp.json`](../../.mcp.json) (`refero`, HTTP, token via `REFERO_MCP_TOKEN` — never commit the token). Methodology lives in the `refero-design` skill; **invoke the skill, don't freestyle the tools** — its non-negotiables (research before design, don't copy one reference, don't average references into a safe middle, don't change token meanings, validate the render against the locked reference) are the point.

Three research layers — combine them, don't pick one:

| Layer | Tools | Use for |
|-------|-------|---------|
| **Styles** — visual direction / taste | `refero_search_styles` → `refero_get_style` | Look and feel, typography system, section rhythm, elevation, imagery strategy. Web marketing/product pages only — no in-app screens. |
| **Screens** — concrete UI decisions | `refero_search_screens` (`platform: "web"`) → `refero_get_screen`, `refero_get_similar_screens`, `refero_get_screen_image` | Page structure, component choice, content hierarchy, copy, empty/error/loading states. Search by what is literally on screen ("pricing toggle", "delete account modal"), not by adjective. |
| **Flows** — journey logic | `refero_search_flows` → `refero_get_flow` | Multi-step sequences: onboarding, sign-up, upload, cancellation. Step count, decision points, recovery paths. |

Rules for this repo:

- **Read the `refero-design` skill's `references/anti-ai-slop.md` *before* choosing a direction** (`~/.claude/skills/refero-design/references/anti-ai-slop.md`), and score the render against its checklist after. The skill ships it; not reading it is how a surface ends up with cards everywhere, a dark canvas nobody asked for, a decorative one-word colour highlight, and a hero with copy left and a product panel right — all four of which this repo shipped once and then had to rebuild.
- **Pick the primary reference on distinctiveness, not on buildability.** The subtle failure: the image-led reference gets demoted "because we cannot produce the photography", the easiest reference gets promoted, and the output is average with a citation attached. A demanding reference is a media problem to solve (generate the asset, or an intentional placeholder with fixed aspect ratio and real art direction), not a reason to pick the safe one. If you do demote, record what was unbuildable and how the substitute keeps the trait.
- **Composition comes from the primary, not from habit.** If the section stack would be identical under any other reference, only tokens were taken. Ask what layout the reference would actually produce — a document, a contact sheet, a ledger, a poster — and build that.
- **A clean checklist is not a passing grade.** Anti-slop measures ways to be *bad*; removing all of them (no cards, no hue, one weight, no radius) can leave a surface with no reason to look at it. Answer the memorability and identity questions *before* implementing: what would a viewer recall tomorrow, and could this belong to another company — or another category? A surface that scored clean on every tell was still rejected as "lame and boring"; see [`../runs/2026-07-30-design-slop-postmortem.md`](../runs/2026-07-30-design-slop-postmortem.md).
- **Distinctive is not the same as appropriate.** Check the candidate against the *domain's own visual world* before reaching for a design-canon reference. Freight has DOT guide signs, reflective tape, hazard placards, dot-matrix rate cons; an archival architecture portfolio was genuinely distinctive and completely wrong for a product about trucks going dark at 3am.
- **Consider motion.** If the subject changes over time — a queue, a board, a countdown, a live figure — the design has a time dimension, and ignoring it is a decision rather than a default. `/demo` shipped three static passes for a product whose whole nature is that it moves.
- **Build the craft, then measure it.** [`../recipes/add-premium-surface.md`](../recipes/add-premium-surface.md) is the step-by-step: show the product as a real panel, three surface levels, depth as four concrete details, two real type faces, one accent spent sparingly, motion at the subject's cadence, one structural memorable move. Then `bun run design:audit -- --url <url> --scope <sel> --accent <#hex>` ([`scripts/design-audit.ts`](../../scripts/design-audit.ts)) for the numbers — accent economy, type faces, depth counts, contrast, overflow, reduced-motion.
- **Never build the metaphor literally.** A concept informs tone, palette, density and what the page shows. A page that *is* a waybill or a hero that *is* a road sign is a costume — two of the four rejected `/demo` passes died on exactly that.
- **Run [`design-critic`](../../.claude/agents/design-critic.md) on the render before calling it done.** It judges screenshots against the anti-slop tells and the litmus tests and never reads the route source. P0/P1 findings block. This is the only gate in the repo that can fail a design for looking generic — typecheck, unit tests, e2e and the browser walk all pass happily on a templated page.
- **Synthesize, then map to tokens.** Refero references carry their own palettes; this repo's tokens still win (guardrail below). Take structure, rhythm, hierarchy, motion intent, copy strategy, imagery role — then express them with `app/app.css` semantics. A reference's accent color becomes `--primary`, not a new hex.
- **Direction is already locked** for the public surface: [`../codebase/design-system.md`](../codebase/design-system.md) (Cursor + Linear). Extending that surface = research *within* the locked direction. Only a deliberate redesign re-opens the lock, and that updates `design-system.md` in the same PR.
- **Record the evidence.** Named references + the concrete decisions taken from each go in the feature doc (`.brain/features/<slug>/<slug>.md`, "Design research" section) — or in `design-system.md` when the direction itself moves. A design decision with no named reference is vibe memory, which this rule exists to prevent.
- **Every tier-2 change still ends in a browser walk** — see Verification below. Refero research is not proof.
- If `REFERO_MCP_TOKEN` is unset the MCP tools are absent: fall back to the `refero-design` skill's bundled craft references + tier 1, and say so in the run note. Don't silently design from memory.

### Scoped design systems — when a surface needs its *own* visual language

Tier 2 sometimes produces a direction that is genuinely not this app's: a surface marketing a different product, a white-label skin, a microsite. "Tokens win" would flatten it back into the starter's monochrome — which is not a guardrail, it is a straitjacket. The escape hatch is a **scoped token override**, and it is the only sanctioned way to introduce a second visual language.

**How.** `app/app.css` declares `@theme inline { --color-background: var(--background); … }`, so every Tailwind colour utility resolves through a CSS variable *at use time*. Redefine the **same variable names** under a scope selector and everything inside restyles — including untouched ShadCN components, with zero component edits:

```css
/* app/routes/<surface>/<name>-theme.css */
[data-surface="loadline"] {
  --background: oklch(0.121 0.017 7.8);
  --primary: oklch(0.592 0.219 24.2);
  --border: oklch(0.313 0.015 4.4);
  --radius: 0.375rem;          /* rounded-md derives as --radius - 2px */
}
/* Re-assert under .dark if the surface must ignore the app theme (see rule 4 below). */
.dark [data-surface="loadline"] { /* … same values … */ }
```

```tsx
import "./loadline-theme.css";
<div data-surface="loadline" className="min-h-svh bg-background text-foreground">
```

**Rules.**

1. **Same token names, new values.** Never invent parallel names (`--loadline-bg`) — the point is that existing components pick the theme up for free. JSX inside the scope stays semantic (`bg-card`, `text-muted-foreground`, `bg-primary`); a literal colour in JSX is still an anti-pattern, scope or no scope.
2. **Scope with a `data-surface` attribute on the route root**, and keep the stylesheet next to the route that imports it — not in `app/app.css`. The app-wide tokens must be readable without knowing about the exception.
3. **Prove non-leakage.** Load an unrelated route in the same browser session and assert the root tokens are unchanged and the scope attribute is absent. Do it in the browser walk, not by reading the CSS.
4. **Document every deviation from repo norms in the stylesheet header, with the source rule that justifies it.** Loadline is dark in both app themes because its reference's own do/don't list forbids light backgrounds — honouring a reference lock means honouring that too. A deviation with no cited source is drift.
5. **Audit accent discipline before declaring done.** If the reference says the accent is CTA-only, count the painted elements in the browser and fix the leaks — bullets, pills and step numerals attract accents silently. Worked example: `.brain/features/sample-saas-landing/`.
6. **The starter's tokens remain the default.** This is for a surface with a genuinely separate identity, not a way to dodge `design-system.md` on an ordinary page.

**Guardrail — tokens win over both tools (outside a declared scope).** This repo already has a committed visual language: [`../codebase/design-system.md`](../codebase/design-system.md) (refero-derived Linear/Cursor direction) + the semantic CSS variables in `app/app.css`. `ui-ux-pro-max` and Refero output are **advisory on structure and behavior, never on raw color values**. Map every recommendation onto existing semantic tokens; if a genuinely new color is needed, add it via the "Adding a new color" steps above. Hardcoding a hex a tool printed is still an anti-pattern.

**One design authority.** The generic `frontend-design` plugin was removed from [`.claude/settings.json`](../../.claude/settings.json) on purpose — three overlapping design skills means whichever fires first wins, and the generic one averages back toward default AI styling (`refero-design` forbids running it as a parallel authority). Tier 1 + tier 2 + the tokens are the whole stack.

## Verification (browser proof before done)

For frontend changes, **verify in a browser before declaring done** — never claim UI works from reading code.

For a **feature-level flow**, spawn the [`feature-verifier`](../../.claude/agents/feature-verifier.md) sub-agent (slug + golden path + one error path). It drives the live app with the Playwright CLI (throwaway headless script run via `bun`), screenshots each state, and writes a verdict doc to [`features/<slug>/verifications/<date>.md`](../features/index.md). Verdict must be PASS. For a **trivial tweak** (copy, spacing), a manual `bun run dev` walk noted in the run note is enough.

Test admin credentials: `admin@test.local` / `TestAdmin123!`. Setup: see `library.md` test-credentials section.

E2E smoke specs (CI regression net): `library.md`.

## Anti-patterns

- `zodResolver(...)` — use `effectResolver`
- Hardcoded hex/rgb/oklch in className
- Template literals or `+` for conditional classes — use `cn()`
- Forms without `<Form>` + RHF — every form goes through ShadCN Form
- Inline `<button>` styling — use `<Button variant=... />`
- Missing `data-testid` on interactive elements
