import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRPCError } from "@trpc/server";
import type { AppLoadContext } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { createAuth, type Auth } from "@/auth/server";
import { requireSession } from "@/lib/session";
import { makeAppRuntime, type AppRuntime } from "@/runtime";
import { createCallerFactory, createTRPCContext } from "@/trpc";
import { appRouter } from "@/trpc/router";

/**
 * A ban must end the user's sessions in the same step (issue #69).
 *
 * The bug: the app's ban roads (`admin.banUser`, `admin.bulkBanUsers`,
 * `admin.updateUser` with `banned: true`) only set the `banned` flag. Better
 * Auth refuses to CREATE a session for a banned user, but its `getSession`
 * never reads the flag, so a session that was live before the ban kept
 * working: protected tRPC calls and guarded loaders let the banned user in
 * until the cookie expired, days later.
 *
 * Why this file breaks the "no D1" rule, on purpose: the claim is that a live
 * session dies, and only a real session can die. This runs real local D1
 * (wrangler's platform proxy, in memory), real Better Auth and the real tRPC
 * router; nothing under test is mocked.
 */

// `import.meta.env.DEV` is always true under vitest, which makes
// `timingMiddleware` sleep 100-499ms of real time per call.
vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const PASSWORD = "correct-horse-battery-staple";
const BASE_URL = "http://localhost";
const MIGRATIONS = fileURLToPath(new URL("../../../drizzle/", import.meta.url));

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
type Account = { userId: string; email: string; headers: Headers };

let proxy: Proxy;
let db: D1Database;
let auth: Auth;
let runtime: AppRuntime;
let loadContext: AppLoadContext;
let admin: Account;

const headersFrom = (setCookie: Headers): Headers =>
  new Headers({
    cookie: setCookie
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });

const signUp = async (email: string): Promise<Account> => {
  const res = await auth.api.signUpEmail({
    body: { name: email.split("@")[0], email, password: PASSWORD },
    returnHeaders: true,
  });
  return { userId: res.response.user.id, email, headers: headersFrom(res.headers) };
};

const signIn = async (email: string): Promise<Headers> => {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  return headersFrom(res.headers);
};

// A fresh context per call: the session is resolved when the context is built,
// so reusing one would hide a session that died after it was built.
const callerFor = async (headers: Headers) =>
  createCallerFactory(appRouter)(await createTRPCContext({ headers, runtime }));

const sessionRows = async (userId: string) =>
  (
    await db
      .prepare("SELECT count(*) AS n FROM session WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>()
  )?.n;

const bannedFlag = async (userId: string) =>
  (
    await db
      .prepare("SELECT banned FROM user WHERE id = ?")
      .bind(userId)
      .first<{ banned: number | null }>()
  )?.banned;

/** "ok", or the tRPC code the next protected call was refused with. */
const nextProtectedCall = (headers: Headers): Promise<string> =>
  callerFor(headers)
    .then((caller) => caller.user.createWorkflow({ email: "probe@ban.test", metadata: {} }))
    .then(
      () => "ok",
      (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`)
    );

/** "allowed", or "<status> <Location>" of the redirect the loader guard threw. */
const nextGuardedLoader = (headers: Headers): Promise<string> =>
  requireSession(new Request(`${BASE_URL}/dashboard`, { headers }), loadContext).then(
    () => "allowed",
    (e: unknown) =>
      e instanceof Response
        ? `${e.status} ${e.headers.get("Location")}`
        : `not a Response: ${String(e)}`
  );

const stateOf = async (account: Pick<Account, "userId" | "headers">) => ({
  sessionRows: await sessionRows(account.userId),
  protectedCall: await nextProtectedCall(account.headers),
  loader: await nextGuardedLoader(account.headers),
});

const LIVE = { sessionRows: 1, protectedCall: "ok", loader: "allowed" };
const ENDED = { sessionRows: 0, protectedCall: "UNAUTHORIZED", loader: "302 /login" };

const signInRefusal = (email: string): Promise<unknown> =>
  signIn(email).then(
    () => "signed in",
    (e: unknown) => e
  );

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  db = proxy.env.DATABASE;

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const statements = readFileSync(`${MIGRATIONS}${file}`, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) await db.prepare(statement).run();
  }

  // The proxy has no workflow binding and no secret; the protected probe
  // (`user.createWorkflow`) needs the first, Better Auth the second.
  const env = {
    ...proxy.env,
    BETTER_AUTH_SECRET: "ban-ends-sessions-test-secret-0123456789abcdef",
    EXAMPLE_WORKFLOW: { create: async () => ({ id: "wf-test" }) },
  } as unknown as Env;

  auth = createAuth(env.DATABASE, env.BETTER_AUTH_SECRET, BASE_URL);
  runtime = makeAppRuntime(env, BASE_URL);
  loadContext = { auth } as unknown as AppLoadContext;

  const adminEmail = "admin@ban.test";
  await signUp(adminEmail);
  await db.prepare("UPDATE user SET role = 'admin' WHERE email = ?").bind(adminEmail).run();
  const adminUser = await db
    .prepare("SELECT id FROM user WHERE email = ?")
    .bind(adminEmail)
    .first<{ id: string }>();
  // Sign in after the role change so the admin's session carries the role.
  admin = { userId: adminUser?.id ?? "", email: adminEmail, headers: await signIn(adminEmail) };
}, 60_000);

afterAll(async () => {
  await runtime?.dispose();
  await proxy?.dispose();
});

type Road = { name: string; ban: (userId: string) => Promise<unknown> };

const ROADS: Road[] = [
  {
    name: "tRPC admin.banUser",
    ban: async (userId) => (await callerFor(admin.headers)).admin.banUser({ userId }),
  },
  {
    name: "tRPC admin.bulkBanUsers",
    ban: async (userId) =>
      (await callerFor(admin.headers)).admin.bulkBanUsers({ userIds: [userId] }),
  },
  {
    name: "tRPC admin.updateUser with banned: true",
    ban: async (userId) =>
      (await callerFor(admin.headers)).admin.updateUser({ userId, data: { banned: true } }),
  },
  {
    name: "Better Auth auth.api.adminUpdateUser with banned: true",
    ban: (userId) =>
      auth.api.adminUpdateUser({
        body: { userId, data: { banned: true } },
        headers: admin.headers,
      }),
  },
  {
    // Control: Better Auth's own ban already deletes sessions. Pins that the
    // library road keeps doing so.
    name: "Better Auth auth.api.banUser",
    ban: (userId) => auth.api.banUser({ body: { userId }, headers: admin.headers }),
  },
];

describe("a ban ends the user's sessions at once", { timeout: 60_000 }, () => {
  it.each(ROADS.map((road, i) => ({ ...road, email: `road${i + 1}@ban.test` })))(
    "$name: session rows gone, next protected call and next guarded loader refused",
    async ({ ban, email }) => {
      // Catches: a ban road that sets the flag but leaves the live session
      // working (the production bug), on any of the five ways to ban.
      const victim = await signUp(email);
      expect(await stateOf(victim), "precondition: victim signed in").toEqual(LIVE);

      await ban(victim.userId);

      expect(await bannedFlag(victim.userId), "the ban itself landed").toBe(1);
      expect(await stateOf(victim)).toEqual(ENDED);
    }
  );

  it("ends only the banned user's sessions: a bystander stays signed in", async () => {
    // Catches: a session delete with a missing or wrong WHERE, which would
    // sign out everyone (or the wrong user) on every ban.
    const target = await signUp("bulk-target@ban.test");
    const bystander = await signUp("bystander@ban.test");
    // The admin holds two sessions (sign-up, then sign-in after the role
    // change), so compare against its own state before the ban.
    const adminBefore = await stateOf(admin);

    await (await callerFor(admin.headers)).admin.bulkBanUsers({ userIds: [target.userId] });

    expect(await bannedFlag(target.userId)).toBe(1);
    expect(await stateOf(bystander)).toEqual(LIVE);
    expect(await stateOf(admin), "the admin who banned stays signed in").toEqual(adminBefore);
  });

  it("an update that does not ban leaves the session alive", async () => {
    // Catches: ending sessions on every admin.updateUser, or on any update
    // that mentions `banned` (including `banned: false`).
    const victim = await signUp("not-banned@ban.test");

    await (await callerFor(admin.headers)).admin.updateUser({
      userId: victim.userId,
      data: { name: "Renamed" },
    });
    expect(await stateOf(victim), "after a name change").toEqual(LIVE);

    await (await callerFor(admin.headers)).admin.updateUser({
      userId: victim.userId,
      data: { banned: false },
    });
    expect(await stateOf(victim), "after banned: false").toEqual(LIVE);
  });

  it("refuses a new sign-in while banned", async () => {
    // Catches: the fix (or a Better Auth upgrade) dropping the
    // session.create guard, so a banned user signs straight back in.
    const victim = await signUp("banned-signin@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({ userId: victim.userId });
    const rowsBefore = await sessionRows(victim.userId);

    expect(await signInRefusal(victim.email)).toMatchObject({
      statusCode: 403,
      body: { code: "BANNED_USER" },
    });
    expect(await sessionRows(victim.userId), "no session row was created").toBe(rowsBefore);
  });

  it("after unban, the session from before the ban stays dead", async () => {
    // Catches: a "ban" that only hides the session (a flag check at read
    // time) instead of deleting it, which an unban would bring back to life.
    const victim = await signUp("unban-old@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({ userId: victim.userId });
    await (await callerFor(admin.headers)).admin.unbanUser({ userId: victim.userId });

    expect(await stateOf(victim)).toEqual(ENDED);
  });

  it("after unban, a new sign-in works and passes the protected call", async () => {
    // Catches: unbanUser leaving the flag set, or the fix blocking the user
    // for good after an unban.
    const victim = await signUp("unban-new@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({ userId: victim.userId });
    await (await callerFor(admin.headers)).admin.unbanUser({ userId: victim.userId });

    const fresh = await signIn(victim.email);

    expect(await bannedFlag(victim.userId)).toBe(0);
    expect(await nextProtectedCall(fresh)).toBe("ok");
    expect(await nextGuardedLoader(fresh)).toBe("allowed");
  });

  it("a ban whose expiry is already past still ends the live session at once", async () => {
    // Catches: skipping the session delete when expiresAt is set (or is in
    // the past), on the reasoning that the ban "does not count".
    const victim = await signUp("expired-live@ban.test");

    await (await callerFor(admin.headers)).admin.banUser({
      userId: victim.userId,
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    });

    expect(await stateOf(victim)).toEqual(ENDED);
  });

  it("a ban whose expiry is past lets the next sign-in through and clears the flag", async () => {
    // Catches: an expired ban that still locks the user out, or a sign-in
    // that gets through but leaves `banned` set.
    const victim = await signUp("expired-signin@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({
      userId: victim.userId,
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    });

    const fresh = await signIn(victim.email);

    expect(await bannedFlag(victim.userId)).toBe(0);
    expect(await nextProtectedCall(fresh)).toBe("ok");
  });

  it("a ban whose expiry is in the future refuses sign-in", async () => {
    // Catches: treating any ban with an expiry as already expired.
    const victim = await signUp("future-ban@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({
      userId: victim.userId,
      expiresAt: new Date("2999-01-01T00:00:00Z"),
    });

    expect(await signInRefusal(victim.email)).toMatchObject({
      statusCode: 403,
      body: { code: "BANNED_USER" },
    });
    expect(await bannedFlag(victim.userId)).toBe(1);
  });
});
