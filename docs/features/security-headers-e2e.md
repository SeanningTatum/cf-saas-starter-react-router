---
slug: security-headers-e2e
title: Security headers, checked in a real browser
ticket: https://github.com/SeanningTatum/cf-saas-starter-react-router/issues/72
date: 2026-11-22
ui: false
base: main
---

# Security headers, checked in a real browser

The tests: `e2e/security-headers.spec.ts`, and `workers/__tests__/security-headers.test.ts` for the header text. The policy itself is in [security headers](../security-headers.md).

## Why

`workers/app.ts` wraps every Worker response with the header set from `workers/security-headers.ts` and puts a fresh nonce in `script-src`; the server renders that nonce on each inline `<script>`. The unit tests pin the header text; the e2e spec checks the wiring in a real browser:

- each page's document carries the whole set, compared against the module itself so the spec cannot drift from it;
- the nonce in the header is the nonce on every `<script>` in the raw HTML;
- the page loads and hydrates with no CSP violation.

The e2e server is Vite dev, so the Worker runs with `dev: true` (no HSTS, `ws:` in `connect-src`). Static files skip the Worker in dev; `public/_headers` is pinned by `workers/__tests__/security-headers.test.ts` instead.

The spec records CSP violations two ways: a `securitypolicyviolation` listener (added by Playwright before any page script, so the page CSP does not apply to it) and Chrome's console report. The listener does not depend on Chrome's wording, which has changed between versions; the console is what a developer sees. Both report to the test process, so a reload does not lose them. The watcher is installed once per page, and `checkPage` clears the lists before each load.
