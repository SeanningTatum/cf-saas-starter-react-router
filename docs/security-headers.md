# Security headers

`workers/security-headers.ts` holds the whole set: a Content Security Policy (CSP), HSTS, `X-Frame-Options: DENY`, `nosniff`, a referrer policy and a permissions policy. Two paths carry it:

- **Pages and API routes.** `workers/app.ts` wraps every response it returns with `withSecurityHeaders`. It overwrites a header of the same name, so a route cannot loosen the policy on its own.
- **Static assets.** Cloudflare serves `build/client` without running the Worker, so it reads `public/_headers`. That file is generated from the module; never edit it by hand.

Dev differs in three ways: `connect-src` adds `ws:` for Vite's reload socket, there is no `upgrade-insecure-requests`, and there is no HSTS, so localhost is never pinned to https.

## The nonce

`workers/app.ts` makes a fresh nonce for each request and puts it in `script-src`. An inline `<script>` runs only if it carries that nonce: take it from `useNonce()` (`app/lib/csp-nonce.ts`), as `app/root.tsx` does. Styles need no nonce, and must not get one: a nonce in `style-src` would switch `'unsafe-inline'` off.

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
