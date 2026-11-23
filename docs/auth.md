# Auth

How auth is set up and which rules it enforces. Better Auth runs the sign-in. This repo sets its config, its session rules and its admin rules.

## Config per environment

Five variables. `app/auth/config.ts` reads and checks them on each request.

| Variable | What it does | Dev build, unset | Any other build, unset or invalid |
|----------|--------------|------------------|-----------------------------------|
| `BETTER_AUTH_SECRET` | Signs sessions and tokens. At least 32 characters. | Falls back to a dev-only secret. | Auth refuses to start. |
| `BETTER_AUTH_URL` | The origin the app is served from. Sets auth links, the origin check and Secure cookies. | Follows each request's own origin. | Auth refuses to start. |
| `AUTH_TRUSTED_ORIGINS` | Extra origins that may send cookie-carrying requests to the auth API. Comma-separated. The base URL's own origin is always trusted. | No extra origins. | No extra origins. |
| `TURNSTILE_SITE_KEY` | Public key of the Turnstile widget. Ships to the browser. | Cloudflare's always-pass test key. | Turnstile is off if both keys are unset. A half pair or a published test key refuses to start. |
| `TURNSTILE_SECRET_KEY` | Private key the server uses to check a Turnstile token. | Cloudflare's always-pass test secret. | Same as the site key. |

The Turnstile rules have [their own section](#turnstile).

A dev build is `bun run dev`. Every other build is not dev: `bun run preview`, the `preview` environment, staging and production.

**This is an owner step.** A fresh deploy answers every request with a 500 until `BETTER_AUTH_URL` is set. The log line `Failed to construct AuthApi` carries a `ConfigurationError` that names the field (`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` or `AUTH_TRUSTED_ORIGINS`).

### Accepted forms

- **Secret**: 32 or more characters, and not the dev-only fallback or Better Auth's own built-in secret. A non-dev build refuses both. `openssl rand -hex 32` or `openssl rand -base64 32` is long enough.
- **Base URL**: `https://...`, or `http://localhost` or `http://127.0.0.1` with any port. Any other `http://` host is refused. A path is dropped; only the origin is kept. An `https` URL turns on Secure, `__Secure-` prefixed cookies.
- **Trusted origins, exact**: a bare origin, no path, query or credentials. A trailing slash is dropped.
- **Trusted origins, wildcard**: `https://` (`http://` only in a dev build), then a host that starts with `*.` or `*-`, then a domain you own of at least two labels. Only one `*`. A bare shared suffix (`workers.dev`, `pages.dev`) is refused. One bad entry fails the whole list.

| Entry | Result |
|-------|--------|
| `https://*.example.com` | Pass |
| `https://*-my-app-preview.my-team.workers.dev` | Pass (the Workers per-PR preview form: `https://*-<worker>-preview.<subdomain>.workers.dev`) |
| `https://*.my-team.workers.dev` | Pass (every Worker on one account) |
| `https://*.workers.dev` | Fail (all of `workers.dev`) |
| `https://*.com` | Fail (one label) |
| `https://a.*.example.com` | Fail (`*` inside the host) |
| `https://*example.com` | Fail (`*` glued to a name) |
| `http://*.example.com` | Fail outside a dev build |

### Where to set each

| Variable | Production | `preview` environment |
|----------|------------|-----------------------|
| `BETTER_AUTH_SECRET` | `wrangler secret put BETTER_AUTH_SECRET` | `wrangler secret put BETTER_AUTH_SECRET --env preview` |
| `BETTER_AUTH_URL` | `vars` in `wrangler.jsonc` | `vars` under `env.preview` in `wrangler.jsonc` |
| `AUTH_TRUSTED_ORIGINS` | `vars` in `wrangler.jsonc` | `vars` under `env.preview` in `wrangler.jsonc` |
| `TURNSTILE_SITE_KEY` | `vars` in `wrangler.jsonc`, or a secret | `vars` under `env.preview`, or `wrangler secret put TURNSTILE_SITE_KEY --env preview` |
| `TURNSTILE_SECRET_KEY` | `wrangler secret put TURNSTILE_SECRET_KEY` | `wrangler secret put TURNSTILE_SECRET_KEY --env preview` |

```jsonc
{
  "vars": { "BETTER_AUTH_URL": "https://app.example.com" },
  "env": {
    "preview": {
      "vars": { "BETTER_AUTH_URL": "https://my-app-preview.my-team.workers.dev" }
    }
  }
}
```

Secrets are not in `wrangler.jsonc`, so `wrangler types` sees one only through a local `.dev.vars` or `.env`, which a fresh clone and a CI runner lack. `workers/env.d.ts` declares every secret on `Env` (interface merging with the generated type), so `bun run typecheck` does not depend on local secret files. A new secret gets a line there.

Wrangler does not inherit `vars` into an environment, so set them in both blocks. Local dev reads `.dev.vars` (copy `.dev.vars.example`).

`wrangler.jsonc` is generated. `scripts/first-time-setup.ts` builds it with `buildWranglerConfig` in `scripts/lib/wrangler-config.ts` and writes it again on a re-run, carrying over every `vars` block already in the file (top level and each environment). Teardown rewrites it from the placeholder values. `bun run setup --auth-url <url>` (and `--auth-url-preview`, `--auth-url-staging`) sets `BETTER_AUTH_URL` without touching anything else; see [the set-up wizard](setup.md). The rate-limit bindings are different: the builder emits them ([Rate limits](#rate-limits)).

## Sessions, cookies, passwords

| Setting | Value | Where |
|---------|-------|-------|
| Session lifetime | 7 days | `SESSION_EXPIRES_IN_SECONDS`, `app/lib/constants/auth.ts` |
| Session refresh | At most once a day | `SESSION_UPDATE_AGE_SECONDS` |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Secure` when the base URL is `https` | `SESSION_COOKIE_SAME_SITE`, `app/auth/server.ts` |
| Password length | 8 to 128 characters | `PASSWORD_MIN_LENGTH`, `PASSWORD_MAX_LENGTH` |
| Client IP | From the `cf-connecting-ip` header | `CLIENT_IP_HEADER` |
| Origin check | On | `disableOriginCheck: false` in `app/auth/server.ts` |

The cookie cache is off. With it on, a session would stay valid in the cookie after a ban until the cache ran out. With it off, each request reads the user from D1, so a ban bites at once.

## Bans

A ban ends the user's sessions when it is written, and the app reads the ban again each time it resolves a session.

- **On write**: an `after` hook on user update (`endSessionsOnBan`, `app/auth/ban-hooks.ts`) deletes the user's sessions when the new row holds an active ban. It covers Better Auth's own endpoints and any write that passes through its database hooks. The tRPC `admin` update (`app/repositories/user.ts`) deletes the sessions in the same D1 batch as the ban.
- **On read**: `activeSession` (`app/auth/ban.ts`) turns a session of a banned user into no session. It runs in `requireSession`, `requireAdmin` and `redirectIfAuthenticated` (`app/lib/session.ts`), in `SessionLive` for tRPC (`app/services/session.ts`), and in the upload route (`app/routes/api/upload-file.ts`). So a ban written by hand in the database still locks the user out of the app.
- **Expiry**: a ban whose `banExpires` has passed counts as no ban. A ban with no expiry clears an old `banExpires` (`clearExpiryOnOpenBan`, and the same rule in the repository), so an earlier timed ban cannot lift a new permanent one.

### Why the sign-in buttons wait for hydration

The sign-in and sign-up forms submit through JavaScript. Before React hydrates, a submit would fall back to the browser's native form submit. `useHydrated` (`app/hooks/use-hydrated.ts`) is false during the server render and hydration and true after, and the submit buttons stay disabled until it turns true, so an early click does nothing and the password never reaches a URL. Test: "ignores a submit before hydration and keeps the password out of the URL (issue #49)" (`e2e/auth.spec.ts`).

### Why tRPC resolves the session through `SessionLive`

`createTRPCContext` (`app/trpc/index.ts`) reads the session through the `Session` service and `SessionLive(headers)`, the one place that resolves a session for tRPC, so the ban check above runs there too. `SessionLive` needs the request's headers, so it is provided per call and not added to `AppServices`, which is built before the headers reach it. It wraps Better Auth's `getSession` in `Effect.tryPromise`: a call that throws becomes an `ExternalServiceError` and a logged 500, not a defect. Before, `Effect.promise` turned it into a defect. Test: "fails with ExternalServiceError when getSession throws" (`app/services/__tests__/session.test.ts`).

## Admin actions: one rule set

**Protected user.** An admin may not change another admin or themself. `isProtectedUser` in `app/auth/protected-user.ts` holds the rule. A user is an admin if any entry in their comma-separated `role` is `admin` (`hasAdminRole`). The refusal reads `Cannot modify admin users or yourself`.

The rule holds on both roads:

- **tRPC**: `UserRepository` (bulk, update and delete paths) calls `isProtectedUser`. `adminProcedure` uses `hasAdminRole`.
- **Better Auth's admin endpoints**: `adminGuard` (`app/auth/admin-guard.ts`) runs before each admin endpoint. It reads the target user, or the target session's user, and refuses a protected one. It also refuses a banned admin caller, and a request whose target it cannot read.

`app/lib/constants/admin.ts` classifies every admin endpoint:

| List | Endpoints | Why |
|------|-----------|-----|
| `ADMIN_PATHS_TARGETING_USER_ID` | `set-role`, `update-user`, `ban-user`, `impersonate-user`, `revoke-user-sessions`, `remove-user`, `set-user-password`, `list-user-sessions` | Guarded. Each acts on one user by id. |
| `ADMIN_PATHS_TARGETING_SESSION_TOKEN` | `revoke-user-session` | Guarded. It names a session; the guard finds that session's user. |
| `ADMIN_PATHS_REVIEWED_AS_OPEN` | `unban-user`, `create-user`, `get-user`, `list-users`, `stop-impersonating`, `has-permission` | Reviewed and left open. They create a user, read data, undo a restriction, or end an action on the caller's own session, so there is no protected target to refuse. |

A drift test (`app/lib/constants/__tests__/admin.test.ts`) lists the admin endpoints of the installed Better Auth. It fails when an upgrade adds one that is in none of the three lists. Classify the new endpoint before the upgrade merges.

When an admin changes a user's email, `emailVerified` resets to `false`. The guard does it for Better Auth's `update-user`, and `emailVerifiedAfterUpdate` does it for the tRPC update. A change that keeps the same email leaves the flag as sent.

## Rate limits

Four rules, each a Workers Rate Limiting binding. The store and the reasons: [ADR 0002](adr/0002-rate-limit-store.md).

| Rule | Binding | Limit per 60 s | Key | Covers |
|------|---------|----------------|-----|--------|
| `signIn` | `AUTH_SIGN_IN_LIMITER` | 10 | Client IP | Each `POST` under `/api/auth/sign-in/` |
| `signUp` | `AUTH_SIGN_UP_LIMITER` | 5 | Client IP | Each `POST` under `/api/auth/sign-up/` |
| `authApi` | `AUTH_API_LIMITER` | 60 | Client IP | Each other `POST` under `/api/auth/` |
| `upload` | `UPLOAD_LIMITER` | 20 | User id | `POST /api/upload-file`, after the session check |

The limits are in `RATE_LIMIT_REQUESTS_PER_PERIOD` (`app/lib/constants/rate-limit.ts`).

`GET`, `HEAD` and `OPTIONS` are never limited. A request matches one rule: a sign-in call counts against `signIn` and not also against `authApi`. A bare `/api/auth` write, with no path after it, falls under `authApi`. Rule names, paths, messages and limits live in `app/lib/constants/rate-limit.ts`.

**The key.** For the auth rules the key comes from the `cf-connecting-ip` header (`CLIENT_IP_HEADER`) through `addressKey` (`app/auth/request-gate.ts`). An IPv4 address is kept whole. An IPv6 address is cut to its /64 prefix, so a caller who holds a whole /64 does not get a new count for each address in it. An IPv4-mapped IPv6 address counts as the IPv4 address. A value that parses as neither is used as sent. The upload rule keys on the user id.

**The path.** `normalizedPath` cleans the path before a rule is picked: it decodes percent-encoded unreserved characters, lower-cases, collapses repeated slashes and drops a trailing slash. A differently written path gets the same rule as the plain one.

**Where the check runs.** The `action` of `app/routes/api/auth.$.ts` runs `authGate` (`app/auth/request-gate.ts`), which calls `guardAuthRequest`, and only then hands the request to Better Auth. If the gate itself breaks, the route logs the fault, reports it to the error reporter as an `action` error, and still hands the request on (it fails open). In a non-dev build, `authGate` also logs one warning (`TURNSTILE_OFF_WARNING`) when it handles a sign-in or sign-up while Turnstile is off. The upload route calls `RateLimiter.check` itself. The `RateLimiter` service (`app/services/rate-limit.ts`) wraps the binding. Better Auth's own limiter is off (`rateLimit: { enabled: false }` in `app/auth/server.ts`): it counts in memory in each isolate, so two requests that land on two isolates get two separate counts. The gate runs before the Turnstile check, so a limited request costs no call to Cloudflare. Every attempt counts, pass or fail.

**What a limited caller gets.**

| Caller | Response |
|--------|----------|
| Auth API | `429`, header `Retry-After: 60`, body `{"code":"TOO_MANY_REQUESTS","message":"Too many attempts. Wait a minute, then try again."}` |
| Sign-in and sign-up form | `refusal.rate_limited` in `app/locales/*/auth.json`: "Too many attempts. Wait a minute, then try again." |
| Upload route | `429`, header `Retry-After: 60`, body `{"success":false,"error":"Too many uploads. Wait a minute, then try again."}` |
| A tRPC procedure that fails with `RateLimitError` | `TOO_MANY_REQUESTS` (`appErrorToTRPC`, `app/lib/effect-trpc.ts`). No procedure checks a limit today. |

`Retry-After` is always the period (60), not the time left in the window, so it can overstate the wait.

**The upload route.** In order: the session, the limit, a `content-length` check, then the body read. A declared length above `MAX_UPLOAD_REQUEST_BYTES` (the file cap plus a 64 KiB allowance for the form envelope, `app/lib/constants/upload.ts`) gets `413`. A body that is not a form gets `400`. A rate-limited upload is an expected refusal: the route does not log it as an error and does not report it.

**Change a limit.** Edit the number in `RATE_LIMIT_REQUESTS_PER_PERIOD` (`app/lib/constants/rate-limit.ts`). `RATE_LIMITS` in `scripts/lib/wrangler-config.ts` builds from it, so the builder follows. `wrangler.jsonc`, which Cloudflare reads, does not: no command rewrites it for this change alone, so edit `simple.limit` for that rule by hand in both blocks (top level and `env.preview`). Only `first-time-setup.ts` and `teardown.ts` regenerate the file, and each overwrites more than the limits. `scripts/__tests__/wrangler-config.test.ts` fails when the builder's rate-limit bindings differ from those in `wrangler.jsonc`, so a missed edit shows up in `bun run test`; it compares only those bindings, so a checkout that setup has filled with real names and ids still passes. The same test checks that both config blocks bind every rule, that the preview namespace ids differ from the top-level ones, and that every period equals `RATE_LIMIT_PERIOD_SECONDS`. Cloudflare takes a period of 10 or 60 seconds. The code sends `RATE_LIMIT_PERIOD_SECONDS` (60) as `Retry-After`, so a move to 10 is a code change too.

**Add a rule.**

1. Add it to `RATE_LIMIT_BINDINGS` and `RATE_LIMIT_REQUESTS_PER_PERIOD` in `app/lib/constants/rate-limit.ts`. For an auth path, add a prefix to `AUTH_RULE_PATH_PREFIXES`.
2. Add the entry to `RATE_LIMITS` in `scripts/lib/wrangler-config.ts` (its `limit` reads from `RATE_LIMIT_REQUESTS_PER_PERIOD`) and to both blocks of `wrangler.jsonc` (top level and `env.preview`), each with its own new `namespace_id`. Run `bun run cf-typegen` so `Env` gains the binding.
3. Call it: an auth path needs no call beyond the prefix (`authRuleFor`, `app/auth/request-gate.ts`); any other route calls `RateLimiter.check(rule, key)`, and a rule the Turnstile check also guards goes in `TURNSTILE_GUARDED_RULES`.
4. Test it: the rule in `app/auth/__tests__/request-gate.test.ts` or the route's test, and `app/services/__tests__/rate-limit.test.ts`. The config test already loops over every rule.

**Namespace ids are yours to pick.** A `namespace_id` is a number you choose. The repo ships `1001` to `1004` and, for preview, `2001` to `2004`. Nothing is created in Cloudflare and setup has no step for it. Pick ids no other limiter on your account uses: see [Known limits](#known-limits). Preview has its own ids so its traffic never counts against production.

**Locally.** `react-router dev` and the unit harness (`getPlatformProxy` in `app/trpc/__tests__/real-d1.ts`) run Miniflare's simulation of the binding, with the limits from `wrangler.jsonc`. A request with no `cf-connecting-ip` uses the key `no-client-ip`, so every local caller shares one count. Send the header to get a count of your own. The e2e specs do: each spec file sends its own address (`e2e/lib/client-ip.ts`), so one file's attempts never limit another's.

**What this store cannot do.**

- Counts are kept per Cloudflare location and are approximate. A caller who reaches two locations can pass more than the limit in all.
- The period is 10 or 60 seconds. There is no hourly or daily limit and no lockout.
- The key is the IP (an IPv6 address by its /64). Many users behind one address share one count; one user who changes address starts a new one.
- If the binding is missing or throws, the check logs `Rate limiter fault; the request goes on unlimited` and lets the request through (it fails open). If the auth gate itself fails, the route logs `Auth rate-limit gate failed; the request goes on unlimited`, reports the fault as an `action` error and does the same. Watch the logs for both lines.

## Turnstile

Cloudflare Turnstile guards `POST /api/auth/sign-in/email` and `POST /api/auth/sign-up/email` (`TURNSTILE_PROTECTED_ENDPOINTS`). The control is on the server. Better Auth's `captcha` plugin (`app/auth/server.ts`) reads the token from the `x-captcha-response` header and checks it with Cloudflare's `siteverify` endpoint, passing the caller's IP. The widget on the forms only fetches the token. A request sent without the browser gets the same check.

### Key rules

`resolveAuthConfig` (`app/auth/config.ts`) decides. A blank value counts as unset.

| Keys | Dev build | Any other build |
|------|-----------|-----------------|
| Both unset | Cloudflare's always-pass test pair. Turnstile is on. | **Turnstile is off.** No widget, no token check. |
| Both set | Used as given, test keys included. | Used, unless either one is a published Cloudflare test key (`TURNSTILE_PUBLISHED_TEST_KEYS`). Then auth refuses to start. |
| One set | Auth refuses to start. | Auth refuses to start. |

To refuse to start is to answer every request with a 500. The log line `Failed to construct AuthApi` carries a `ConfigurationError` that names `TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET_KEY`.

**A deploy with no keys runs with Turnstile off.** It does not fail. Set the keys before you rely on the check.

### Owner steps

1. In the Cloudflare dashboard, open Turnstile and add a widget. List the hostnames that serve the forms: the production host, and each preview host (`<worker>-preview.<subdomain>.workers.dev`, and the per-PR alias hosts if you use them). `localhost` is not needed: a dev build uses test keys.
2. Set the keys for production and for `--env preview` ([Where to set each](#where-to-set-each)). The site key is public and reaches the browser through the login and sign-up loaders. The secret key stays a secret:

```bash
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put TURNSTILE_SECRET_KEY --env preview
```

### What a refusal looks like

| Case | Status and code | Form message (`refusal.*` in `app/locales/*/auth.json`) |
|------|-----------------|--------------------------------------------------------|
| No token sent | `400` `MISSING_RESPONSE` | `captcha_failed`: "The security check didn't go through. Let it run again, then submit." |
| Cloudflare rejects the token | `403` `VERIFICATION_FAILED` | `captcha_failed` |
| `siteverify` unreachable or errors | `500` `UNKNOWN_ERROR` | `captcha_unavailable`: "The security check isn't responding right now. Try again shortly." |
| Over a rate limit | `429` `TOO_MANY_REQUESTS` | `rate_limited` |

The forms map these with `authRefusalFor` (`app/lib/auth-errors.ts`) and reset the widget after each attempt. A `500 UNKNOWN_ERROR` reads as "unavailable" only when Turnstile is on. The check fails closed: if Cloudflare cannot be reached, nobody signs in or signs up. The widget shows its own `turnstile.*` messages when its script fails to load, the challenge fails or the token expires.

### See the failure path locally

With the keys unset, a dev build passes every check. To see a refusal, put Cloudflare's always-fail pair in `.dev.vars` (it is in `.dev.vars.example`), restart `bun run dev` and submit the form. Remove the pair afterwards.

Cloudflare's always-pass secret accepts any non-empty token. So in a dev build with the default keys, the "token rejected" path (`403`) cannot be reached. Only the always-fail pair reaches it. The "no token" path (`400`) needs only a request without the header.

### Needs the network

The widget loads its script from `https://challenges.cloudflare.com`, and the server calls `siteverify` there. Dev, the e2e gate and the browser all need to reach it, test keys or not. Offline, the form shows the `script_failed` message and cannot submit. The CSP sources it needs (`script-src`, `frame-src`) are in [`security-headers.md`](security-headers.md#hosts-outside-the-apps-own-origin).

## Known limits

- **`/get-session`**: Better Auth's own `/get-session` endpoint still returns a session for a user banned by hand in the database. Only the app's reads (above) refuse it. A ban written through the app or Better Auth deletes the sessions, so this affects only a hand-written ban.
- **`BETTER_AUTH_TRUSTED_ORIGINS` and `BETTER_AUTH_SECRETS`**: Better Auth reads both from `process.env`. The Workers runtime fills `process.env` from bindings with compatibility date 2025-04-01 or later and `nodejs_compat`. Better Auth then applies them without this repo's checks. Do not set either. This repo's `wrangler.jsonc` pins 2025-03-25, so it does not fill `process.env` today, but a later date bump would.
- **Dashboard admin UI**: `app/routes/dashboard/_index.tsx` shows the admin section when `role === "admin"` exactly. A user with a list such as `user,admin` is an admin to the server but sees no admin section there. It is display only; the server checks use `hasAdminRole`.
- **Turnstile covers two endpoints.** Only `sign-in/email` and `sign-up/email` check a token. Every other auth route has none: a password reset or a password change, if you turn those on. Those sit under the `authApi` limit (60 per minute), and any other path under `/sign-in/` or `/sign-up/` sits under that path's own limit. Email and password is the only sign-in method enabled today. If you add another sign-in method, add its path to `TURNSTILE_PROTECTED_ENDPOINTS`.
- **Rate limits skip reads.** `GET`, `HEAD` and `OPTIONS` are never counted, `/get-session` included.
- **The IP is the whole key for the auth rules.** Behind a proxy that does not set `cf-connecting-ip`, every caller shares the key `no-client-ip`, and one caller can use up the limit for all. The `authApi` limit counts per address, not per account, so it does not slow one account tried from many addresses.
- **The captcha plugin has no `allowedHostnames`.** Cloudflare's test keys answer with a fixed hostname, and preview hosts change with each PR, so a hostname list in the code would break both. The control is the widget's own hostname list in the Cloudflare dashboard ([Owner steps](#owner-steps)).
- **The limiter runs inside the route.** By then the Worker has built the request's runtime and resolved the session, so a limited request still pays for that. A fork under heavy abuse can move the check to the top of `workers/app.ts`.
- **Namespace ids are shared across an account.** Every Worker on one Cloudflare account that uses the same `namespace_id` numbers shares one counter. A second project on the account should pick other numbers than `1001` to `1004` and `2001` to `2004`.
