---
slug: trpc-dev-flag
title: tRPC dev-only behaviour stays out of production
ticket: none
date: 2026-11-22
ui: false
base: main
---

# tRPC dev-only behaviour stays out of production

The tests: `app/trpc/__tests__/index.test.ts`.

## Why

The tests cover the two symptoms of one bug. tRPC derived `isDev` from `process.env.NODE_ENV`, which does not exist on
Workers, so it resolved to `true` in production. That leaked stacks in error payloads and slept 100-499ms on every
procedure call.

Both helpers (`stripStackOutsideDev`, `devDelayMs`) take `dev` as an argument and do not read the module-level `isDev`,
because `import.meta.env.DEV` is always `true` under vitest and the production branch would otherwise be unreachable. It
is the same pattern as `isLevelEnabled` in `lib/log-format.ts`.

`stripStackOutsideDev` casts its result `as S`, so TypeScript cannot verify that required `data` fields survive the
spread. The "preserves every data key except stack" test is that guarantee: an edit that drops an extra key fails there
and does not compile silently.

The fix passes `isDev` from `import.meta.env.DEV`, which Vite replaces at build time, to `initTRPC.create`. `stripStackOutsideDev` is defence in depth on top: it keeps stacks out of client payloads even if that config regresses. `timingMiddleware` reads the same module-level `isDev`, not `t._config.isDev`, so both call sites share one source and stay off tRPC's internal config shape. `app/trpc/__tests__/production-error-payload.test.ts` builds the router with `DEV` false and checks that it holds `isDev: false` and that a 500 carries no stack.
