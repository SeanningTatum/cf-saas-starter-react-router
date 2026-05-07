# Recipe: Add a React Router page

## Steps

### 1. File location

Mirror existing structure under [`app/routes/`](../../app/routes/). Naming:
- `_layout.tsx` for nested layouts
- `_index.tsx` for index routes
- Route segments map to URL paths

### 2. Register in [`app/routes.ts`](../../app/routes.ts)

Add via `route()` / `index()` / `prefix()` / `layout()` from `@react-router/dev/routes`. File-based imports auto-typed via `+types/<name>`.

### 3. Auth gate (if protected)

```ts
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) throw redirect("/login");
  // For admin pages: also check role
  if (session.user.role !== "admin") throw redirect("/dashboard");
  return { user: session.user };
}
```

> Page gate is UX. Server-side enforcement still required at procedure level (`adminProcedure` in [app/trpc/index.ts](../../app/trpc/index.ts#L94)). Don't trust the page guard alone.

### 4. Data fetching

Loader → hit tRPC via `context.trpc.<router>.<proc>(...)`:

```ts
const users = await context.trpc.user.getUsers();
return { users };
```

Or call the repository directly through the runtime if loader-only logic:

```ts
const users = await context.runtime.runPromise(
  Effect.gen(function* () {
    const repo = yield* UserRepository;
    return yield* repo.getUsers({ page: 0, limit: 100 });
  })
);
```

### 5. i18n

- Declare namespaces:
  ```ts
  export const handle = { i18n: ["dashboard", "common"] };
  ```
- Inside component: `const { t } = useTranslation("dashboard");`
- Add strings to `app/locales/en/dashboard.json`
- Namespace MUST match the `useTranslation()` arg

### 6. UI

- Compose ShadCN primitives from `app/components/ui/`
- Feature components in `app/components/<feature>/` or under the route folder
- Tailwind v4 — use semantic CSS vars (`bg-background`, `text-foreground`), not raw colors

### 7. Forms

- Schema in `app/lib/schemas/<domain>.ts` (Effect Schema)
- `useForm({ resolver: effectResolver(MySchema) })`
- shadcn `<Form>` + `<FormField>` + `<FormMessage>`
- Submit via tRPC mutation (`useMutation`)

### 8. Verify

- `bun run dev` → manually exercise route
- Check golden path + auth-redirect path
- For protected routes: verify unauthenticated user redirected
- For admin routes: verify non-admin user redirected to `/dashboard`

## Definition of done

- [ ] Route declared in `app/routes.ts`
- [ ] Loader handles auth (if applicable)
- [ ] `handle.i18n` namespace declared
- [ ] All visible strings via `t(...)` (no hardcoded English)
- [ ] Forms use Effect Schema + effectResolver
- [ ] Manual smoke test green

## Anti-patterns

- ❌ Auth check via `useEffect` in component — runs after render, leaks UI flash
- ❌ Using `process.env` or direct `context.cloudflare.env.X` in a loader — go through `context.trpc` or `context.runtime`
- ❌ `useTranslation()` without `handle.i18n` declaration — namespace not loaded server-side, hydration mismatch
- ❌ Hardcoded text in JSX bypassing i18n
- ❌ Trusting page-level auth check as the only gate (procedures must enforce too)
