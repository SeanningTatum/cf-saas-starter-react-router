---
slug: trpc-input-bounds
title: Every tRPC input has a size limit
ticket: https://github.com/SeanningTatum/cf-saas-starter-react-router/issues/70
date: 2026-11-22
ui: false
base: main
---

# Every tRPC input has a size limit

The tests: `app/trpc/__tests__/input-bounds.test.ts`.

## Why

The hole: a string with no `maxLength`, or an array with no `maxItems`, lets one request push an unbounded payload into a
query. `userIds` had no maximum, and D1 refuses a statement that binds more than 100 variables, so a large bulk action
failed outright. `search` matched `%` and `_` as wildcards.

The first half of the test walks every procedure's input schema. The second half calls the bulk and search procedures on
real D1 (see [real-d1-tests](real-d1-tests.md)), because only real SQLite shows a variable-limit overflow or how a
search term is matched.

How the walker reads a schema:

- Declared types known to have a fixed size (`FIXED_SIZE`) are matched on the decoder, which survives
  `.annotations(...)` and cannot be copied by naming a schema "DateFromSelf". `superjson` lets a client send a Map or a
  Set, so any other declaration (`ReadonlySetFromSelf`, `Uint8ArrayFromSelf`, `Schema.declare`) fails.
- The caps a refinement chain puts on the node below it apply; the outermost wins.
- A parser that is not an Effect Schema cannot be walked, so it fails.
- Test users go straight into D1: signing up 50 users would hash 50 passwords.
