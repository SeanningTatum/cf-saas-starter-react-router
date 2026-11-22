import { TRPCError } from "@trpc/server";
import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCallerFactory,
  createTRPCRouter,
  protectedProcedure,
  type Context,
} from "@/trpc";
import { appRouter } from "@/trpc/router";
import type { AppRuntime } from "@/runtime";
import { startRealApp, type AppCaller, type RealApp } from "./real-d1";

/**
 * LEVELS: who may call each procedure. `user.deleteUser` once sat behind
 * `protectedProcedure`, so any signed-in user could delete any account by id,
 * and no test asked "who may call this?". A new procedure fails here until it
 * is listed with its level, so the level is a choice a reviewer sees.
 *
 * OWNERSHIP: every `protected` procedure again. The hole it stands for is a
 * signed-in user acting on another user's row by sending its id. Real cases
 * run on real D1 (`./real-d1.ts`): the guard is a WHERE clause, and a stub
 * cannot run one.
 */
type Level = "protected" | "admin";

const LEVELS: Record<string, Level> = {
  "admin.getUsers": "admin",
  "admin.getUser": "admin",
  "admin.updateUser": "admin",
  "admin.banUser": "admin",
  "admin.unbanUser": "admin",
  "admin.deleteUser": "admin",
  "admin.bulkBanUsers": "admin",
  "admin.bulkDeleteUsers": "admin",
  "admin.bulkUpdateUserRoles": "admin",
  "admin.dbHealth": "admin",
  "analytics.getUserGrowth": "admin",
  "analytics.getUserStats": "admin",
  "analytics.getRoleDistribution": "admin",
  "analytics.getVerificationDistribution": "admin",
  "analytics.getRecentSignupsCount": "admin",
};

/** Acting as the other user, makes a row through the router and returns the input that names it. */
type OwnershipCase = (other: AppCaller) => Promise<unknown>;

// A case is one line, e.g.
//   "notes.get": async (other) => ({ noteId: (await other.notes.create({ title: "x" })).id }),
const OWNERSHIP: Record<string, "takes no id" | OwnershipCase> = {};

// `import.meta.env.DEV` is always true under vitest, which makes
// `timingMiddleware` sleep 100-499ms of real time per call.
vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

// The auth middleware runs before input parsing and before the handler, so a
// refused call never reaches the runtime. A runtime that fails loudly proves it.
const runtime = new Proxy(
  {},
  {
    get: (_, key) => () =>
      Promise.reject(new Error(`runtime.${String(key)} reached by a refused call`)),
  }
) as unknown as AppRuntime;

const contextAs = (user: { id: string; role: "admin" | "user" } | null) =>
  ({
    headers: new Headers(),
    runtime,
    auth: user === null ? null : { session: { id: `session-${user.id}` }, user },
  }) as unknown as Context;

/** Calls the procedure at a dotted path on a tRPC caller. */
const callAt = (caller: unknown, path: string, input?: unknown): Promise<unknown> => {
  const procedure = path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node === null || node === undefined ? undefined : Reflect.get(Object(node), key)),
      caller
    );
  return typeof procedure === "function"
    ? Promise.resolve(procedure(input))
    : Promise.reject(new Error(`no procedure at ${path}`));
};

const call = (role: "admin" | "user" | null, path: string) =>
  callAt(
    createCallerFactory(appRouter)(contextAs(role === null ? null : { id: "u1", role })),
    path
  );

/** "ok", or the tRPC code the call was refused with. */
const outcomeOf = (call: Promise<unknown>): Promise<string> =>
  call.then(
    () => "ok",
    (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`)
  );

/** The assertion every ownership case runs, real or fixture. */
const expectOtherUsersRowRefused = async <C>(
  path: string,
  makeInput: (other: C) => Promise<unknown>,
  callers: { me: C; other: C }
) => {
  const input = await makeInput(callers.other);
  expect(["FORBIDDEN", "NOT_FOUND"], `${path} with another user's row, as a user who does not own it`).toContain(
    await outcomeOf(callAt(callers.me, path, input))
  );
  // The control: the owner gets through with the same input, so the refusal
  // above is about ownership, not about an input that names nothing.
  expect(
    await outcomeOf(callAt(callers.other, path, input)),
    `${path} with the same input, as the row's owner`
  ).toBe("ok");
};

const REAL_CASES = Object.entries(OWNERSHIP).flatMap(([path, entry]) =>
  entry === "takes no id" ? [] : [{ path, makeInput: entry }]
);

describe("procedure auth levels", () => {
  it("lists every procedure in the router, and nothing else", () => {
    // Catches: a procedure added without a declared level, and a removed
    // procedure (such as the old user.deleteUser) coming back unnoticed.
    expect(Object.keys(appRouter._def.procedures).sort()).toEqual(
      Object.keys(LEVELS).sort()
    );
  });

  it("has no user-level procedure that deletes users", () => {
    // Catches: the original hole. Deleting an account by id is admin-only
    // and lives at admin.deleteUser.
    expect(Object.keys(appRouter._def.procedures)).not.toContain("user.deleteUser");
  });

  it("has no user-level procedure that lists users", () => {
    // Catches: user.getUsers coming back, which let any signed-in user read
    // the id, name and image of up to 100 other users. Listing users is
    // admin-only and lives at admin.getUsers.
    expect(Object.keys(appRouter._def.procedures)).not.toContain("user.getUsers");
  });

  it.each(Object.keys(LEVELS))("%s refuses an anonymous caller", async (path) => {
    // Catches: a procedure moved to publicProcedure.
    await expect(call(null, path)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each(Object.keys(LEVELS).filter((path) => LEVELS[path] === "admin"))(
    "%s refuses a signed-in non-admin",
    async (path) => {
      // Catches: an admin procedure moved to protectedProcedure.
      await expect(call("user", path)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
});

describe("ownership of protected procedures", () => {
  it("lists every protected procedure, and nothing else", () => {
    // Catches: a new protected procedure shipped without anyone deciding
    // whether it takes another user's id.
    expect(Object.keys(OWNERSHIP).sort()).toEqual(
      Object.keys(LEVELS).filter((path) => LEVELS[path] === "protected").sort()
    );
  });

  // Skipped while there is no case, so workerd does not start.
  describe.skipIf(REAL_CASES.length === 0)("on real D1", { timeout: 60_000 }, () => {
    let app: RealApp;
    let callers: { me: AppCaller; other: AppCaller };

    beforeAll(async () => {
      app = await startRealApp();
      const me = await app.signUp("me@ownership.test");
      const other = await app.signUp("other@ownership.test");
      callers = { me: await app.callerFor(me.headers), other: await app.callerFor(other.headers) };
    }, 60_000);

    afterAll(async () => {
      await app?.dispose();
    });

    it.each(REAL_CASES)("$path refuses a signed-in user another user's row", ({ path, makeInput }) =>
      expectOtherUsersRowRefused(path, makeInput, callers)
    );
  });
});

/**
 * The ownership assertion on a router built to pass or fail it. With no real
 * case today, nothing else shows that the assertion can fail.
 */
describe("the ownership assertion itself", () => {
  let owner = "";
  const NoteIdInput = Schema.standardSchemaV1(
    Schema.Struct({ noteId: Schema.String.pipe(Schema.maxLength(64)) })
  );

  const fixtureRouter = createTRPCRouter({
    notes: createTRPCRouter({
      create: protectedProcedure.mutation(({ ctx }) => {
        owner = ctx.auth.user.id;
        return { id: "note-1" };
      }),
      getOwned: protectedProcedure.input(NoteIdInput).query(({ ctx, input }) => {
        if (owner !== ctx.auth.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        return { id: input.noteId };
      }),
      // The hole: found by id alone.
      getLeaky: protectedProcedure.input(NoteIdInput).query(({ input }) => ({ id: input.noteId })),
    }),
  });

  const callerAs = (id: string) => createCallerFactory(fixtureRouter)(contextAs({ id, role: "user" }));
  const callers = { me: callerAs("alice"), other: callerAs("bob") };
  const othersNote = async (other: typeof callers.other) => ({
    noteId: (await other.notes.create()).id,
  });

  it("passes a procedure that refuses a non-owner", async () => {
    await expectOtherUsersRowRefused("notes.getOwned", othersNote, callers);
  });

  it("fails a procedure that hands one user another user's row", async () => {
    await expect(expectOtherUsersRowRefused("notes.getLeaky", othersNote, callers)).rejects.toThrow(
      "notes.getLeaky with another user's row, as a user who does not own it"
    );
  });
});
