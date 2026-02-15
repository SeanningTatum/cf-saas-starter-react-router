# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev              # Start dev server (auto-runs local DB migrations) → http://localhost:5173
bun run build            # Production build
bun run deploy           # Build + deploy to Cloudflare Workers
bun run typecheck        # Full typecheck (cf-typegen + react-router typegen + tsc)
bun run db:generate      # Generate Drizzle migration after schema changes
bun run db:migrate:local # Apply migrations to local D1
bun run db:migrate:remote # Apply migrations to remote D1
bun run db:studio        # Open Drizzle Studio (visual DB browser)
bun run test:e2e         # Run Playwright tests
bun run test:e2e:ui      # Playwright tests with UI
bunx playwright test path/to/test.spec.ts  # Run a single test file
```

## Context Docs

Detailed context docs (architecture, data models, API, security, features, integrations, user journeys) are in `.cursor/context/`.

## Architecture Overview

**Stack**: Cloudflare Workers (edge runtime) + React Router v7 (SSR) + tRPC + D1/Drizzle + Better Auth + ShadCN/Tailwind

### Runtime: Cloudflare Workers, NOT Node.js

**Never use `process.env`**. Access environment through Cloudflare bindings:
- In loaders/actions: `context.cloudflare.env.DATABASE`
- In tRPC routes: `ctx.db` (pre-built), or `ctx.cfContext.BINDING_NAME`

Available bindings (see `worker-configuration.d.ts`): `DATABASE` (D1), `BUCKET` (R2), `AI`, `BETTER_AUTH_SECRET`, `EXAMPLE_WORKFLOW`.

### Data Flow

```
React Component → tRPC Client Hook (client-side)
                → HTTP /api/trpc/*
                → tRPC Router (validation with Zod)
                → Repository function (pure data access)
                → Drizzle ORM → D1 Database

React Route Loader → context.trpc.* (server-side caller, no HTTP roundtrip)
```

### Key Files & Entry Points

- **`workers/app.ts`** — Worker entry. Creates tRPC context, auth instance, and passes them into React Router's `AppLoadContext`
- **`app/routes.ts`** — All route definitions (flat file, not file-system routing)
- **`app/trpc/index.ts`** — tRPC context creation, middleware, procedure definitions (`publicProcedure`, `protectedProcedure`, `adminProcedure`)
- **`app/trpc/router.ts`** — Combined app router
- **`app/trpc/routes/`** — Individual tRPC sub-routers
- **`app/trpc/client.tsx`** — Client-side tRPC/React Query provider
- **`app/db/schema.ts`** — All Drizzle table definitions
- **`app/auth/server.ts`** — Better Auth server config
- **`app/auth/client.ts`** — Better Auth React client
- **`app/routes/api/auth.$.ts`** — Auth API catch-all handler
- **`app/routes/api/trpc.$.ts`** — tRPC API catch-all handler

### Repository Pattern

Data access lives in `app/repositories/{entity}.ts`. Repositories are pure functions:
- First parameter is always `db: Database` (where `type Database = Context["db"]`)
- Use typed input interfaces, not raw params
- Throw custom errors from `app/models/errors/`
- Never import tRPC or access session/context directly

```typescript
// Repository: app/repositories/user.ts
export async function getUser(db: Database, input: GetUserInput) { ... }

// tRPC route calls repository:
export const adminRouter = createTRPCRouter({
  getUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ ctx, input }) => userRepository.getUser(ctx.db, input)),
});
```

### Error Handling

Custom error classes in `app/models/errors/`:
- `NotFoundError`, `CreationError`, `UpdateError`, `DeletionError` (repository layer)
- `BucketError`, `BucketUploadError` (R2 storage layer)
- `ValidationError` (input validation)

### Route Conventions

- Route types: `import type { Route } from "./+types/page"`
- Loaders: `export async function loader({ request, context }: Route.LoaderArgs)`
- Components: `export default function Page({ loaderData }: Route.ComponentProps)`
- Layout files: `_layout.tsx` with `<Outlet />`
- Session check in loaders via `context.auth.api.getSession({ headers: request.headers })`

### Database Schema Conventions

- All schemas in `app/db/schema.ts` using `sqliteTable`
- Booleans: `integer("col", { mode: "boolean" })`
- Timestamps: `integer("col", { mode: "timestamp_ms" })` with `unixepoch('subsecond') * 1000` default
- Enums: `text("col", { enum: ["a", "b"] })`
- Always include `createdAt` and `updatedAt`

### Zod in tRPC

Use `import { z } from "zod/v4"` in tRPC route files (Zod v4 compat import).

### Constants

Place in `app/lib/constants/` grouped by domain, with central re-export from `index.ts`.

### Context-Based Clients

When integrating external services: create client instances once in `workers/app.ts` context, then pass through tRPC context to routes and repositories as parameters. Never instantiate clients inside repositories.

## UI Patterns

- Components: `app/components/ui/` (ShadCN-based, Radix primitives)
- Add new ShadCN components: `bunx shadcn@latest add [component-name]`
- Use `cn()` from `@/lib/utils` for conditional class merging
- Use CSS variables for colors (never raw hex values) — see `app/app.css`
- Forms: always use ShadCN Form + React Hook Form + Zod
- After mutations, always invalidate relevant tRPC queries via `api.useUtils()`
- Icons: `@tabler/icons-react` and `lucide-react`
