# Run note: keyboard focus rings never paint (app-wide)

- **Date opened**: 2026-07-30
- **Status**: open — deliberately **not** fixed in the `feat/design-intelligence` PR (user decision: separate PR, keeps the demo PR scoped)
- **Found by**: independent verification worker during `/create-pr-with-review` on `feat/design-intelligence`. Two workers ran the same browser walk; one passed the page, the other failed it on focus visibility. The disagreement is what surfaced this.
- **Severity**: accessibility — keyboard-only users cannot see where focus is, anywhere in the app.

## Symptom

Tab to any ShadCN `Button` (or an `asChild` link rendered as one). The element genuinely matches `:focus-visible`, but nothing is drawn:

```
matchesFocusVisible: true
outline:      none 3px oklab(0.708 0 0 / 0.5)     ← width + colour set, style suppressed
box-shadow:   rgba(0,0,0,0) 0px 0px 0px 0px, ...  ← all five layers transparent
--tw-ring-shadow: 0 0 0 calc(3px + 0px) color-mix(in oklab, oklch(0.708 0 0) 50%, transparent)
```

So the ring variable is computed correctly and the outline has a width and colour — but `outline-style` stays `none` (from `outline-none` in the button base class) and `--tw-ring-shadow` never makes it into the element's `box-shadow`. Net: no visible indicator.

## Blast radius — pre-existing, not from that branch

Reproduced with the identical probe on the **pre-existing `/` route** (`a:topbar-github`) and on the new `/demo` route: byte-identical computed values. The base class is shared, so every button, and likely `input`/`select`/trigger variants that use the same `focus-visible:ring-*` pattern, are affected.

Stack: `tailwindcss@^4.2.1` + `@tailwindcss/vite@^4.2.1`, ShadCN button base class at `app/components/ui/button.tsx:8` (`outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`).

## What is already known about the fix

Injecting `:focus-visible { --tw-outline-style: solid; outline-style: solid; outline-offset: 2px }` at runtime does make an outline appear, but it lands at **1px**, not the intended 3px ring — so that is a symptom probe, not the fix. The real question is why the `ring-[3px]` composite `box-shadow` is not being emitted on these elements under Tailwind 4.2; start there rather than papering over it with an outline.

## Scope for the follow-up PR

1. Diagnose the ring/`box-shadow` composition in Tailwind 4.2 for these classes (check whether the `box-shadow` declaration reaching the element comes from a rule that does not reference `--tw-ring-shadow`).
2. Fix in the shared base classes: `app/components/ui/button.tsx` first, then audit `input.tsx`, `select.tsx` and any other component using the same `focus-visible:ring-*` pattern.
3. Verify with a keyboard walk on `/`, `/login`, `/dashboard` and `/demo`, in both themes, with screenshots showing a visible ring — computed styles alone are what made this defect survive this long (see the correction in `features/sample-saas-landing/verifications/2026-07-30.md`).
4. Consider an e2e assertion that the focused element has a non-transparent, non-zero indicator, so this cannot silently regress again.

## Related finding, same decision

Primary CTAs measure 32–40px tall at a 390px viewport, under the 44×44 touch-target guideline — ShadCN's stock `sm`/`lg` sizes, so also app-wide. User decision: note it, change nothing for now. Raising the size variants shifts vertical rhythm on every existing surface and needs its own visual re-verification.
