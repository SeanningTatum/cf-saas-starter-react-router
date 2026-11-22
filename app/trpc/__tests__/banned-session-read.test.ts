import { TRPCError } from "@trpc/server";
import { Layer, ManagedRuntime } from "effect";
import type { AppLoadContext } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { redirectIfAuthenticated, requireSession } from "@/lib/session";
import { action as uploadAction } from "@/routes/api/upload-file";
import { createCallerFactory, createTRPCRouter, protectedProcedure } from "@/trpc";
import { BASE_URL, startRealApp, type Account, type RealApp } from "./real-d1";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const LONG_AGO_MS = Date.parse("2000-01-01T00:00:00Z");
const FAR_AHEAD_MS = Date.parse("2999-01-01T00:00:00Z");

let app: RealApp;
const emptyRuntime = ManagedRuntime.make(Layer.empty);

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

const uploadStatus = async (headers: Headers): Promise<number> => {
  const request = new Request(`${BASE_URL}/api/upload-file`, {
    method: "POST",
    headers,
    body: new FormData(),
  });
  const context = { ...app.loadContext, runtime: emptyRuntime } as unknown as AppLoadContext;
  const result = await uploadAction({ request, context, params: {} } as unknown as Parameters<
    typeof uploadAction
  >[0]);
  return (result as { init: ResponseInit | null }).init?.status ?? 200;
};

const stateOf = async (account: Account) => ({
  sessionRows: await sessionRows(account.userId),
  contextUser: await contextUser(account.headers),
  protectedCall: await protectedCall(account.headers),
  guardedLoader: await guardedLoader(account.headers),
  publicLoader: await publicLoader(account.headers),
  uploadStatus: await uploadStatus(account.headers),
});

const signedIn = (account: Account) => ({
  sessionRows: 1,
  contextUser: account.userId,
  protectedCall: "ok",
  guardedLoader: "allowed",
  publicLoader: "302 /dashboard",
  uploadStatus: 400,
});

const SIGNED_OUT_WITH_ROW_LEFT = {
  sessionRows: 1,
  contextUser: null,
  protectedCall: "UNAUTHORIZED",
  guardedLoader: "302 /login",
  publicLoader: "allowed",
  uploadStatus: 401,
};

beforeAll(async () => {
  app = await startRealApp();
}, 60_000);

afterAll(async () => {
  await emptyRuntime.dispose();
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
