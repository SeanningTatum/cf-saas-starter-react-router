import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { redirectIfAuthenticated, requireSession } from "@/lib/session";
import { action as uploadAction } from "@/routes/api/upload-file";
import { trackedUpload } from "@/routes/api/__tests__/tracked-upload";
import { createCallerFactory, createTRPCRouter, protectedProcedure } from "@/trpc";
import { BASE_URL, startRealApp, type Account, type RealApp } from "./real-d1";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const LONG_AGO_MS = Date.parse("2000-01-01T00:00:00Z");
const FAR_AHEAD_MS = Date.parse("2999-01-01T00:00:00Z");

let app: RealApp;

const probeRouter = createTRPCRouter({ ping: protectedProcedure.query(() => "ok") });

const setBanByHand = (userId: string, banExpiresMs: number | null) =>
  app.db
    .prepare("UPDATE user SET banned = 1, ban_expires = ? WHERE id = ?")
    .bind(banExpiresMs, userId)
    .run();

const sessionRows = async (userId: string) =>
  (
    await app.db
      .prepare("SELECT count(*) AS n FROM session WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>()
  )?.n;

const contextUser = async (headers: Headers) =>
  (await app.contextFor(headers)).auth?.user.id ?? null;

const protectedCall = (headers: Headers): Promise<string> =>
  app
    .contextFor(headers)
    .then((ctx) => createCallerFactory(probeRouter)(ctx).ping())
    .then(
      () => "ok",
      (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`)
    );

const outcomeOf = (run: Promise<unknown>): Promise<string> =>
  run.then(
    () => "allowed",
    (e: unknown) =>
      e instanceof Response
        ? `${e.status} ${e.headers.get("Location")}`
        : `not a Response: ${String(e)}`
  );

const guardedLoader = (headers: Headers) =>
  outcomeOf(requireSession(new Request(`${BASE_URL}/dashboard`, { headers }), app.loadContext));

const publicLoader = (headers: Headers) =>
  outcomeOf(redirectIfAuthenticated(new Request(`${BASE_URL}/login`, { headers }), app.loadContext));

const uploadOutcome = async (headers: Headers) => {
  const { request, bodyRead } = await trackedUpload(`${BASE_URL}/api/upload-file`, { headers });
  const result = await uploadAction({ request, context: app.loadContext, params: {} } as unknown as Parameters<
    typeof uploadAction
  >[0]);
  return { status: (result as { init: ResponseInit | null }).init?.status ?? 200, bodyRead: bodyRead() };
};

const stateOf = async (account: Account) => ({
  sessionRows: await sessionRows(account.userId),
  contextUser: await contextUser(account.headers),
  protectedCall: await protectedCall(account.headers),
  guardedLoader: await guardedLoader(account.headers),
  publicLoader: await publicLoader(account.headers),
  upload: await uploadOutcome(account.headers),
});

const signedIn = (account: Account) => ({
  sessionRows: 1,
  contextUser: account.userId,
  protectedCall: "ok",
  guardedLoader: "allowed",
  publicLoader: "302 /dashboard",
  upload: { status: 400, bodyRead: true },
});

const SIGNED_OUT_WITH_ROW_LEFT = {
  sessionRows: 1,
  contextUser: null,
  protectedCall: "UNAUTHORIZED",
  guardedLoader: "302 /login",
  publicLoader: "allowed",
  upload: { status: 401, bodyRead: false },
};

beforeAll(async () => {
  app = await startRealApp();
}, 60_000);

afterAll(async () => {
  await app?.dispose();
});

describe("a ban is read each time a session is resolved", { timeout: 60_000 }, () => {
  it("a flag set by hand in the database, with the session row left, signs the user out of every app read", async () => {
    const victim = await app.signUp("by-hand@read.test");
    expect(await stateOf(victim), "precondition: signed in").toEqual(signedIn(victim));

    await setBanByHand(victim.userId, null);

    expect(await stateOf(victim)).toEqual(SIGNED_OUT_WITH_ROW_LEFT);
  });

  it("a ban set by hand that ends later still signs the user out", async () => {
    const victim = await app.signUp("ends-later@read.test");
    await setBanByHand(victim.userId, FAR_AHEAD_MS);

    expect(await stateOf(victim)).toEqual(SIGNED_OUT_WITH_ROW_LEFT);
  });

  it("a ban that has run out lets the live session through", async () => {
    const victim = await app.signUp("ran-out@read.test");
    await setBanByHand(victim.userId, LONG_AGO_MS);

    expect(await stateOf(victim)).toEqual(signedIn(victim));
  });

  it("a ban on one user leaves another user's session alone", async () => {
    const banned = await app.signUp("banned-one@read.test");
    const bystander = await app.signUp("bystander@read.test");
    await setBanByHand(banned.userId, null);

    expect(await stateOf(bystander)).toEqual(signedIn(bystander));
  });
});
