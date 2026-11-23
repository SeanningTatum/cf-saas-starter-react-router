import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireSession } from "@/lib/session";
import { createCallerFactory, createTRPCRouter, protectedProcedure } from "@/trpc";
import { BASE_URL, startRealApp, type Account, type RealApp } from "./real-d1";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

let app: RealApp;
let admin: Account;

const signUp = (email: string) => app.signUp(email);
const signIn = (email: string) => app.signIn(email);
const callerFor = (headers: Headers) => app.callerFor(headers);

const sessionRows = async (userId: string) =>
  (
    await app.db
      .prepare("SELECT count(*) AS n FROM session WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>()
  )?.n;

const bannedFlag = async (userId: string) =>
  (
    await app.db
      .prepare("SELECT banned FROM user WHERE id = ?")
      .bind(userId)
      .first<{ banned: number | null }>()
  )?.banned;

const probeRouter = createTRPCRouter({ ping: protectedProcedure.query(() => "ok") });

const nextProtectedCall = (headers: Headers): Promise<string> =>
  app
    .contextFor(headers)
    .then((ctx) => createCallerFactory(probeRouter)(ctx).ping())
    .then(
      () => "ok",
      (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`),
    );

const nextGuardedLoader = (headers: Headers): Promise<string> =>
  requireSession(new Request(`${BASE_URL}/dashboard`, { headers }), app.loadContext).then(
    () => "allowed",
    (e: unknown) =>
      e instanceof Response
        ? `${e.status} ${e.headers.get("Location")}`
        : `not a Response: ${String(e)}`,
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
    (e: unknown) => e,
  );

beforeAll(async () => {
  app = await startRealApp();
  admin = await app.signUpAdmin("admin@ban.test");
}, 60_000);

afterAll(async () => {
  await app?.dispose();
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
      app.auth.api.adminUpdateUser({
        body: { userId, data: { banned: true } },
        headers: admin.headers,
      }),
  },
  {
    name: "Better Auth auth.api.banUser (control: the library's own ban already deletes sessions)",
    ban: (userId) => app.auth.api.banUser({ body: { userId }, headers: admin.headers }),
  },
];

describe("a ban ends the user's sessions at once, so a session live before the ban cannot keep working until its cookie expires (issue #69, see docs/features/ban-ends-sessions.md)", {
  timeout: 60_000,
}, () => {
  it.each(ROADS.map((road, i) => ({ ...road, email: `road${i + 1}@ban.test` })))(
    "$name: session rows gone, next protected call and next guarded loader refused, so no ban road leaves the live session working",
    async ({ ban, email }) => {
      const victim = await signUp(email);
      expect(await stateOf(victim), "precondition: victim signed in").toEqual(LIVE);

      await ban(victim.userId);

      expect(await bannedFlag(victim.userId), "the ban itself landed").toBe(1);
      expect(await stateOf(victim)).toEqual(ENDED);
    },
  );

  it("ends only the banned user's sessions: a bystander and the banning admin (who holds two sessions) stay signed in, so the session delete keeps its WHERE", async () => {
    const target = await signUp("bulk-target@ban.test");
    const bystander = await signUp("bystander@ban.test");
    const adminBefore = await stateOf(admin);

    await (await callerFor(admin.headers)).admin.bulkBanUsers({ userIds: [target.userId] });

    expect(await bannedFlag(target.userId)).toBe(1);
    expect(await stateOf(bystander)).toEqual(LIVE);
    expect(await stateOf(admin), "the admin who banned stays signed in").toEqual(adminBefore);
  });

  it("an update that does not ban leaves the session alive, so neither admin.updateUser nor banned: false ends sessions", async () => {
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

  it("refuses a new sign-in while banned, so a banned user cannot sign straight back in even if an upgrade drops the session.create guard", async () => {
    const victim = await signUp("banned-signin@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({ userId: victim.userId });
    const rowsBefore = await sessionRows(victim.userId);

    expect(await signInRefusal(victim.email)).toMatchObject({
      statusCode: 403,
      body: { code: "BANNED_USER" },
    });
    expect(await sessionRows(victim.userId), "no session row was created").toBe(rowsBefore);
  });

  it("after unban, the session from before the ban stays dead, so a ban deletes the session and does not hide it behind a flag an unban would undo", async () => {
    const victim = await signUp("unban-old@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({ userId: victim.userId });
    await (await callerFor(admin.headers)).admin.unbanUser({ userId: victim.userId });

    expect(await stateOf(victim)).toEqual(ENDED);
  });

  it("after unban, a new sign-in works and passes the protected call, so an unban clears the flag and does not block the user for good", async () => {
    const victim = await signUp("unban-new@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({ userId: victim.userId });
    await (await callerFor(admin.headers)).admin.unbanUser({ userId: victim.userId });

    const fresh = await signIn(victim.email);

    expect(await bannedFlag(victim.userId)).toBe(0);
    expect(await nextProtectedCall(fresh)).toBe("ok");
    expect(await nextGuardedLoader(fresh)).toBe("allowed");
  });

  it("a ban whose expiry is already past still ends the live session at once, so the delete is not skipped when expiresAt is set or past", async () => {
    const victim = await signUp("expired-live@ban.test");

    await (await callerFor(admin.headers)).admin.banUser({
      userId: victim.userId,
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    });

    expect(await stateOf(victim)).toEqual(ENDED);
  });

  it("a ban whose expiry is past lets the next sign-in through and clears the flag, so an expired ban neither locks the user out nor leaves banned set", async () => {
    const victim = await signUp("expired-signin@ban.test");
    await (await callerFor(admin.headers)).admin.banUser({
      userId: victim.userId,
      expiresAt: new Date("2000-01-01T00:00:00Z"),
    });

    const fresh = await signIn(victim.email);

    expect(await bannedFlag(victim.userId)).toBe(0);
    expect(await nextProtectedCall(fresh)).toBe("ok");
  });

  it("a ban whose expiry is in the future refuses sign-in, so a ban with an expiry is not treated as already expired", async () => {
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

const banExpiresOf = async (userId: string) =>
  (
    await app.db
      .prepare("SELECT ban_expires AS banExpires FROM user WHERE id = ?")
      .bind(userId)
      .first<{ banExpires: number | null }>()
  )?.banExpires;

const moveBanExpiryIntoPast = (userId: string) =>
  app.db
    .prepare("UPDATE user SET ban_expires = ? WHERE id = ?")
    .bind(Date.parse("2000-01-01T00:00:00Z"), userId)
    .run();

const timedBetterAuthBan = (userId: string) =>
  app.auth.api.banUser({ body: { userId, banExpiresIn: 3600 }, headers: admin.headers });

type ReBanRoad = {
  name: string;
  firstBan: (userId: string) => Promise<unknown>;
  banAgain: (userId: string) => Promise<unknown>;
};

const RE_BAN_ROADS: ReBanRoad[] = [
  {
    name: "tRPC admin.updateUser",
    firstBan: async (userId) =>
      (await callerFor(admin.headers)).admin.updateUser({
        userId,
        data: { banned: true, banExpires: new Date("2999-01-01T00:00:00Z") },
      }),
    banAgain: async (userId) =>
      (await callerFor(admin.headers)).admin.updateUser({ userId, data: { banned: true } }),
  },
  {
    name: "Better Auth /admin/ban-user",
    firstBan: timedBetterAuthBan,
    banAgain: (userId) => app.auth.api.banUser({ body: { userId }, headers: admin.headers }),
  },
  {
    name: "Better Auth /admin/update-user",
    firstBan: timedBetterAuthBan,
    banAgain: (userId) =>
      app.auth.api.adminUpdateUser({
        body: { userId, data: { banned: true } },
        headers: admin.headers,
      }),
  },
];

describe("a new ban with no expiry replaces an old expiry", { timeout: 60_000 }, () => {
  it.each(RE_BAN_ROADS.map((road, i) => ({ ...road, email: `re-ban${i + 1}@ban.test` })))(
    "$name: a re-ban after a past expiry stores no expiry, so the next sign-in is refused",
    async ({ firstBan, banAgain, email }) => {
      const victim = await signUp(email);
      await firstBan(victim.userId);
      await moveBanExpiryIntoPast(victim.userId);

      await banAgain(victim.userId);

      expect(await banExpiresOf(victim.userId)).toBeNull();
      expect(await signInRefusal(victim.email)).toMatchObject({
        statusCode: 403,
        body: { code: "BANNED_USER" },
      });
      expect(await sessionRows(victim.userId)).toBe(0);
    },
  );
});
