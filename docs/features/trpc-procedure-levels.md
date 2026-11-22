---
slug: trpc-procedure-levels
title: Who may call each tRPC procedure
ticket: none
date: 2026-11-22
ui: false
base: main
---

# Who may call each tRPC procedure

The tests: `app/trpc/__tests__/router.test.ts`.

## Why

`LEVELS` says who may call each procedure. `user.deleteUser` once sat behind `protectedProcedure`, so any signed-in user
could delete any account by id, and no test asked "who may call this?". A new procedure fails the test until it is listed
with its level, so the level is a choice a reviewer sees.

That is why the app router has no `user` router: `user.getUsers` and `user.deleteUser` were both holes. "has no
user-level procedure that deletes users" and "has no user-level procedure that lists users" fail if either comes back.

`OWNERSHIP` lists every `protected` procedure again. The hole it stands for is a signed-in user acting on another user's
row by sending its id. Real cases run on real D1 (see [real-d1-tests](real-d1-tests.md)): the guard is a WHERE clause,
and a stub cannot run one.

An ownership case is one line: acting as the other user, it makes a row through the router and returns the input that
names the row. For example:

```ts
"notes.get": async (other) => ({ noteId: (await other.notes.create({ title: "x" })).id }),
```

The assertion every case runs also has a control: the owner gets through with the same input, so the refusal is about
ownership and not about an input that names nothing. With no real case today, a fixture router built to pass or fail the
assertion is the only proof that the assertion can fail.

The auth middleware runs before input parsing and before the handler, so a refused call never reaches the runtime. The
test passes a runtime that fails loudly to prove it.
