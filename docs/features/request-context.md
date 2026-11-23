---
slug: request-context
title: One request id on every response
ticket: https://github.com/SeanningTatum/cf-saas-starter-react-router/issues/74
date: 2026-11-22
ui: false
base: main
---

# One request id on every response

The tests: `e2e/request-context.spec.ts` (from outside the Worker), and the unit tests in `app/lib/__tests__/request-context.test.ts`, `app/__tests__/runtime.test.ts` and `workers/__tests__/request-flow.test.ts`.

## Why

`workers/app.ts` makes one id per request (`app/lib/request-context.ts`): the trace id of a valid incoming `traceparent`, else a well-formed `cf-ray`, else 16 random bytes as hex. Every Worker response sends it as `x-request-id`, and the root `ErrorBoundary` in `app/root.tsx` shows it so a user can quote it in a bug report.

The e2e spec pins:

- every response carries the header, pages and API routes alike, and each request gets its own id;
- a valid `traceparent` is continued and a malformed one is ignored (one malformed header is enough there; the unit test walks every shape);
- the error page shows the same id the response sent, before and after hydration.

Log lines and spans carry the id too; the unit tests pin those, since the spec cannot read the server's logs. Static files skip the Worker in Vite dev and carry no id, so the spec does not check them.

Notes on the spec:

- `/:lng` matches any single segment, so the missing page it loads has several.
- The 404 test waits on the heading, which renders with or without an id, so a missing id line fails on its own assertion and not as "never hydrated".
- `hydrated` waits until React has hydrated a node: React sets its `__reactProps$…` key on a DOM node only when it claims the node during hydration, so the server HTML alone never passes. The same helper is in `e2e/security-headers.spec.ts`.
- On a cold dev server the first load can die on Vite's "504 Outdated Optimize Dep" and never hydrate (issue #50); one reload recovers it.
