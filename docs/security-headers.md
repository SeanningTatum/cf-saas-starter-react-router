# Security headers

`workers/security-headers.ts` holds the whole set: a Content Security Policy (CSP), HSTS, `X-Frame-Options: DENY`, `nosniff`, a referrer policy and a permissions policy. Two paths carry it:

- **Pages and API routes.** `workers/app.ts` wraps every response it returns with `withSecurityHeaders`. It overwrites a header of the same name, so a route cannot loosen the policy on its own.
- **Static assets.** Cloudflare serves `build/client` without running the Worker, so it reads `public/_headers`. That file is generated from the module; never edit it by hand.

Dev differs in three ways: `connect-src` adds `ws:` for Vite's reload socket, there is no `upgrade-insecure-requests`, and there is no HSTS, so localhost is never pinned to https.

## The nonce

`workers/app.ts` makes a fresh nonce for each request and puts it in `script-src`. An inline `<script>` runs only if it carries that nonce: take it from `useNonce()` (`app/lib/csp-nonce.ts`), as `app/root.tsx` does. Styles need no nonce, and must not get one: a nonce in `style-src` would switch `'unsafe-inline'` off. In the browser `useNonce()` returns `undefined`: the browser hides nonce attributes once it has parsed them, and the context has no made-up default (`app/lib/__tests__/csp-nonce.test.ts`).

## Hosts outside the app's own origin

| Host | Directives | Why |
|------|------------|-----|
| `https://fonts.googleapis.com` | `style-src` | Google Fonts stylesheets |
| `https://fonts.gstatic.com` | `font-src` | Google Fonts files |
| `https://github.com`, `https://avatars.githubusercontent.com` | `img-src` | The kitchen-sink demo avatar |
| `https://challenges.cloudflare.com` | `script-src`, `frame-src` | The Turnstile widget on sign-in and sign-up loads its script from here and renders in a frame from here. `TURNSTILE_ORIGIN` in `app/lib/constants/turnstile.ts`. `frame-src` also keeps `'self'`, which `default-src` allowed before the directive existed. |

## CSP reporting

The policy ends with `report-uri /api/browser-report` and `report-to csp`, and every response carries `Reporting-Endpoints: csp="/api/browser-report"`, both from `workers/security-headers.ts`. The browser posts each violation to that route, which records it as a warning-level error report with source `csp` ([error reporting](agents/error-reporting.md)). The route drops the query string of the page URL and of the blocked URL, caps body size and limits the rate, so it does not log every violation under load.

## Allow a new host

Example: a browser analytics SDK that loads a script from, and posts to, `https://us.i.posthog.com`.

1. In `CSP_SOURCES` in `workers/security-headers.ts`, add `"https://us.i.posthog.com"` to `script-src` and to `connect-src`. Add a host only to the directives it needs: a font host goes in `font-src`, an avatar or image host in `img-src`.
2. Run `bunx vitest run workers/__tests__/security-headers.test.ts -u`. It rewrites the pinned set in the test and `public/_headers`; check the diff.
3. Run `bunx playwright test e2e/security-headers.spec.ts`. It loads the main pages and fails on any CSP violation.

A call the Worker makes itself needs no change: the CSP governs the browser only, and the PostHog adapter in this repo sends events with `fetch` from the Worker.

## Before you change the defaults

- **HSTS** is `max-age=31536000` with no `includeSubDomains`. Add `includeSubDomains` once every subdomain serves https; browsers hold the pin for a year.
- **Caching.** The nonce is per request. Do not let a shared cache store HTML (a Cache Rule, or `Cache-Control: public` on a page): every visitor would get the same nonce.
- **User content.** `script-src 'self'` trusts every script URL on the app's origin. Serve uploaded files from another origin, or with `Content-Disposition: attachment`.

## Why

Each rule below has a test whose title states it.

- **One place applies the headers.** The `fetch` export in `workers/app.ts` wraps the response of every path out of `handle`, both 500s included (a handler that throws, a runtime that cannot be built), and sets `x-request-id` on it. `workers/__tests__/security-headers-on-errors.test.ts`.
- **The response is copied first.** `withSecurityHeaders` builds a new `Response` before it sets headers, because some responses (a `Response.redirect`, for one) have immutable headers. The copy's headers can take `x-request-id` too. `workers/__tests__/security-headers.test.ts`.
- **`img-src` names its hosts.** A bare `https:` would let an injected script send data to any host through an image URL, which is what `connect-src 'self'` is there to stop. `workers/__tests__/security-headers-rules.test.ts`.
- **`style-src` keeps `'unsafe-inline'` and never takes the nonce.** `style` attributes and `<style>` tags from Radix, the charts and Vite dev cannot carry a nonce, and a nonce in the directive turns `'unsafe-inline'` off. `workers/__tests__/security-headers-rules.test.ts`.
- **No HSTS in dev.** A year-long pin on `localhost` would break the developer's other local projects. No `includeSubDomains` in any build: it would lock a fork out of an http-only subdomain for a year. `workers/__tests__/security-headers.test.ts`, `workers/__tests__/security-headers-rules.test.ts`.
