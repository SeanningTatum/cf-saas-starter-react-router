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

## Playwright (manual verification during dev)

For frontend changes, **verify in browser before declaring done**. Use Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill_form`, `browser_take_screenshot`).

Test admin credentials: `admin@test.local` / `TestAdmin123!`. Setup: see `library.md` test-credentials section.

E2E tests: `library.md`.

## Anti-patterns

- `zodResolver(...)` — use `effectResolver`
- Hardcoded hex/rgb/oklch in className
- Template literals or `+` for conditional classes — use `cn()`
- Forms without `<Form>` + RHF — every form goes through ShadCN Form
- Inline `<button>` styling — use `<Button variant=... />`
- Missing `data-testid` on interactive elements
