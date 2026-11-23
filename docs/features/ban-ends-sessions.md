---
slug: ban-ends-sessions
title: A ban ends the user's sessions
ticket: https://github.com/SeanningTatum/cf-saas-starter-react-router/issues/69
date: 2026-11-22
ui: false
base: main
---

# A ban ends the user's sessions

The tests: `app/trpc/__tests__/ban-ends-sessions.test.ts`, on real D1 (see [real-d1-tests](real-d1-tests.md)).

## Why

A ban must end the user's sessions in the same step.

The bug: the app's ban roads (`admin.banUser`, `admin.bulkBanUsers`, `admin.updateUser` with `banned: true`) only set the
`banned` flag. Better Auth refuses to create a session for a banned user, but its `getSession` never reads the flag, so a
session that was live before the ban kept working. Protected tRPC calls and guarded loaders let the banned user in until
the cookie expired, days later.

The claim is that a live session dies. Only a real session can die, so the test runs on the real-D1 harness.

The probe the test calls is a fixture: every procedure in the app router is admin-only, which a non-admin victim never
passes. One procedure on the real `protectedProcedure`, called with the real context, tests the session alone.

Better Auth's own `banUser` already deletes sessions. The test lists it as a control, to pin that the library road keeps
doing so.
