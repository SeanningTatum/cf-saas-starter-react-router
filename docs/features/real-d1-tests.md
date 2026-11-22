---
slug: real-d1-tests
title: Tests that run on real local D1
ticket: none
date: 2026-11-22
ui: false
base: main
---

# Tests that run on real local D1

The harness: `app/trpc/__tests__/real-d1.ts`.

## Why

It runs the whole app on real local D1, for tests whose claim only a real database can prove: a live session dying, a
WHERE clause refusing another user's row, a statement staying under D1's bound-variable limit.

These tests break the "no D1 in unit tests" rule on purpose. A stub returns what the test told it to, so it cannot show
what SQLite does with the query. The harness runs real local D1 (wrangler's platform proxy, in memory, a fresh database
per call), the migrations in `drizzle/`, real Better Auth and the real tRPC router. Nothing under test is mocked.

Two details of the harness:

- Each call gets a fresh tRPC context. The session is resolved when the context is built, so reusing one would hide a
  session that died after it was built.
- `signUpAdmin` signs up, makes the user an admin, then signs in again so the session carries the role.

Each test file must still mock `@/lib/log-format` itself, because `vi.mock` is hoisted per file:
`import.meta.env.DEV` is always true under vitest, which makes `timingMiddleware` sleep 100-499ms of real time per call.
The mock sets `isDev` to false so the tests stay fast and free of real timers.
