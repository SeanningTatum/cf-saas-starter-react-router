# Auth

How auth is set up and which rules it enforces. Better Auth runs the sign-in. This repo sets its config, its session rules and its admin rules.

## Config per environment

Three variables. `app/auth/config.ts` reads and checks them on each request.

| Variable | What it does | Dev build, unset | Any other build, unset or invalid |
|----------|--------------|------------------|-----------------------------------|
| `BETTER_AUTH_SECRET` | Signs sessions and tokens. At least 32 characters. | Falls back to a dev-only secret. | Auth refuses to start. |
| `BETTER_AUTH_URL` | The origin the app is served from. Sets auth links, the origin check and Secure cookies. | Follows each request's own origin. | Auth refuses to start. |
| `AUTH_TRUSTED_ORIGINS` | Extra origins that may send cookie-carrying requests to the auth API. Comma-separated. The base URL's own origin is always trusted. | No extra origins. | No extra origins. |

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

Wrangler does not inherit `vars` into an environment, so set them in both blocks. Local dev reads `.dev.vars` (copy `.dev.vars.example`).

`wrangler.jsonc` is generated. `scripts/first-time-setup.ts` builds it with `buildWranglerConfig` in `scripts/lib/wrangler-config.ts` and overwrites the whole file, so a hand-added `vars` block does not survive a re-run of setup. Teardown also rewrites it from the placeholder values. The builder emits no `vars`. After a re-run, add the `vars` back. To keep them, add them in `buildWranglerConfig` instead.

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

## Known limits

- **`/get-session`**: Better Auth's own `/get-session` endpoint still returns a session for a user banned by hand in the database. Only the app's reads (above) refuse it. A ban written through the app or Better Auth deletes the sessions, so this affects only a hand-written ban.
- **`BETTER_AUTH_TRUSTED_ORIGINS` and `BETTER_AUTH_SECRETS`**: Better Auth reads both from `process.env`. The Workers runtime fills `process.env` from bindings with compatibility date 2025-04-01 or later and `nodejs_compat`. Better Auth then applies them without this repo's checks. Do not set either. This repo's `wrangler.jsonc` pins 2025-03-25, so it does not fill `process.env` today, but a later date bump would.
- **Dashboard admin UI**: `app/routes/dashboard/_index.tsx` shows the admin section when `role === "admin"` exactly. A user with a list such as `user,admin` is an admin to the server but sees no admin section there. It is display only; the server checks use `hasAdminRole`.
