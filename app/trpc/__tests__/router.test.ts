import { TRPCError } from "@trpc/server";
import { Schema, type SchemaAST } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCallerFactory,
  createTRPCRouter,
  protectedProcedure,
  type Context,
} from "@/trpc";
import { appRouter } from "@/trpc/router";
import type { AppRuntime } from "@/runtime";
import { childrenOf, inputAstsOf, joinPath } from "./procedure-inputs";
import type { Account, AppCaller, RealApp } from "./real-d1";

/**
 * Two tables: who may call each procedure, and whose rows a caller may touch.
 *
 * LEVELS, the auth level of every procedure. `user.deleteUser` once sat behind
 * `protectedProcedure`, so any signed-in user could delete any non-admin
 * account by id. Nothing caught it, because no test asked "who may call
 * this?". This table is that question, asked of every procedure. A new
 * procedure fails the first test until it is listed here with its level, so
 * the level is a choice a reviewer sees.
 *
 * `protected` means any signed-in user may call it. Give that level only to a
 * procedure that acts on the caller's own data; one that takes another user's
 * id belongs behind `admin`.
 *
 * OWNERSHIP, whose row a `protected` procedure acts on. Passing the level
 * check only proves the caller is signed in. A procedure that then loads a
 * row by the id it was sent, and never asks who owns that row, lets any
 * signed-in user read or change any other user's rows by sending their id.
 * The guard is usually one WHERE clause in a repository, which is easy to
 * leave out and invisible in review. So every `protected` procedure is listed
 * again here as one of two things:
 * - `takesNoId(why)`: checked, not trusted; its input may hold no field named
 *   `id` or ending in `Id` / `Ids`.
 * - `otherUsersRow(make)`: one line. `make` acts as a second, really signed-in
 *   user, creates a row through the router and returns the input that names
 *   it. The first user must be refused it (FORBIDDEN or NOT_FOUND) and the
 *   owner must not be. These run on real D1 (`./real-d1.ts`), because a stub
 *   cannot run the WHERE clause that does the refusing.
 */
type Level = "protected" | "admin";

const LEVELS: Record<string, Level> = {
  "user.createWorkflow": "protected",
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

type TakesNoId = { readonly kind: "takes no id"; readonly why: string };
type OtherUsersRow<C> = {
  readonly kind: "other user's row";
  readonly makeInput: (other: C) => Promise<unknown>;
};
type Ownership<C> = TakesNoId | OtherUsersRow<C>;

const takesNoId = (why: string): TakesNoId => ({ kind: "takes no id", why });
const otherUsersRow = <C>(makeInput: (other: C) => Promise<unknown>): OtherUsersRow<C> => ({
  kind: "other user's row",
  makeInput,
});

// A case is one line, e.g.
//   "notes.get": otherUsersRow(async (other) => ({ noteId: (await other.notes.create({ title: "x" })).id })),
const OWNERSHIP: Record<string, Ownership<AppCaller>> = {
  "user.createWorkflow": takesNoId(
    "starts a background job from an email and metadata; it reads no stored row"
  ),
};

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

const REFUSED = ["FORBIDDEN", "NOT_FOUND"];

/** The assertion every `otherUsersRow` case runs, real or fixture. */
const expectOtherUsersRowRefused = async <C>(
  path: string,
  makeInput: (other: C) => Promise<unknown>,
  callers: { me: () => Promise<C>; other: () => Promise<C> }
) => {
  const input = await makeInput(await callers.other());
  expect(REFUSED, `${path} with another user's row, as a user who does not own it`).toContain(
    await outcomeOf(callAt(await callers.me(), path, input))
  );
  // The control: the owner gets through with the same input, so the refusal
  // above is about ownership, not about an input that names nothing.
  expect(
    await outcomeOf(callAt(await callers.other(), path, input)),
    `${path} with the same input, as the row's owner`
  ).toBe("ok");
};

const ID_FIELD = /^id$|Ids?$/;

/** Every field in the input whose name says it holds an id, as a dotted path. */
const idFieldsIn = (asts: ReadonlyArray<SchemaAST.AST | null>): string[] => {
  const found = new Set<string>();
  const walk = (ast: SchemaAST.AST, path: string, seen: ReadonlySet<SchemaAST.AST>) => {
    if (seen.has(ast)) return;
    for (const child of childrenOf(ast)) {
      const childPath = joinPath(path, child.segment);
      if (child.segment !== null && ID_FIELD.test(child.segment)) found.add(childPath);
      walk(child.ast, childPath, new Set(seen).add(ast));
    }
  };
  for (const ast of asts) {
    if (ast === null) found.add("<an input that is not an Effect Schema>");
    else walk(ast, "", new Set());
  }
  return [...found].sort();
};

const INPUTS = inputAstsOf(appRouter);
const PROTECTED = Object.keys(LEVELS).filter((path) => LEVELS[path] === "protected");
const NO_ID = Object.keys(OWNERSHIP).filter((path) => OWNERSHIP[path].kind === "takes no id");
const REAL_CASES = Object.entries(OWNERSHIP).flatMap(([path, entry]) =>
  entry.kind === "other user's row" ? [{ path, makeInput: entry.makeInput }] : []
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
      // Catches: an admin procedure moved to protectedProcedure, which hands
      // every signed-in user an admin action.
      await expect(call("user", path)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
});

describe("ownership of protected procedures", () => {
  it("classifies every protected procedure, and nothing else", () => {
    // Catches: a new protected procedure shipped without anyone deciding
    // whether it takes another user's id.
    expect(Object.keys(OWNERSHIP).sort()).toEqual(PROTECTED.sort());
  });

  it.each(NO_ID)("%s, marked as taking no id, has no id field in its input", (path) => {
    // Catches: `{ noteId }` (or `id`, `userIds`) marked "takes no id" to skip
    // the real ownership case.
    expect(idFieldsIn(INPUTS[path] ?? [])).toEqual([]);
  });

  describe.skipIf(REAL_CASES.length === 0)("on real D1", { timeout: 60_000 }, () => {
    let app: RealApp;
    let me: Account;
    let other: Account;

    beforeAll(async () => {
      // Imported here so a run with no real case never starts workerd.
      const { startRealApp } = await import("./real-d1");
      app = await startRealApp();
      me = await app.signUp("me@ownership.test");
      other = await app.signUp("other@ownership.test");
    }, 60_000);

    afterAll(async () => {
      await app?.dispose();
    });

    it.each(REAL_CASES)("$path refuses a signed-in user another user's row", ({ path, makeInput }) =>
      // Catches: a protected procedure that loads a row by the id it was
      // sent without checking who owns it.
      expectOtherUsersRowRefused(path, makeInput, {
        me: () => app.callerFor(me.headers),
        other: () => app.callerFor(other.headers),
      })
    );
  });
});

/**
 * The checks above on a router built to pass or fail them. The real table has
 * no id-taking case today, so without this nothing shows that the ownership
 * assertion can fail at all.
 */
describe("the ownership checks themselves", () => {
  const notes = new Map<string, { id: string; ownerId: string }>();
  const NoteIdInput = Schema.standardSchemaV1(
    Schema.Struct({ noteId: Schema.String.pipe(Schema.maxLength(64)) })
  );
  const findNote = (noteId: string) => {
    const note = notes.get(noteId);
    if (!note) throw new TRPCError({ code: "NOT_FOUND" });
    return note;
  };

  const fixtureRouter = createTRPCRouter({
    notes: createTRPCRouter({
      create: protectedProcedure.mutation(({ ctx }) => {
        const id = `note-${notes.size + 1}`;
        notes.set(id, { id, ownerId: ctx.auth.user.id });
        return { id };
      }),
      // The shape every real case must have: the owner is part of the lookup.
      getOwned: protectedProcedure.input(NoteIdInput).query(({ ctx, input }) => {
        const note = findNote(input.noteId);
        if (note.ownerId !== ctx.auth.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        return note;
      }),
      // The production hole: found by id alone.
      getLeaky: protectedProcedure.input(NoteIdInput).query(({ input }) => findNote(input.noteId)),
      // Refuses everyone, owner included: what a case whose input names no
      // row looks like from outside.
      getNothing: protectedProcedure.input(NoteIdInput).query(() => {
        throw new TRPCError({ code: "NOT_FOUND" });
      }),
    }),
  });

  const callerAs = (id: string) =>
    Promise.resolve(createCallerFactory(fixtureRouter)(contextAs({ id, role: "user" })));
  type FixtureCaller = Awaited<ReturnType<typeof callerAs>>;
  const callers = { me: () => callerAs("alice"), other: () => callerAs("bob") };

  const othersNote = otherUsersRow(async (other: FixtureCaller) => ({
    noteId: (await other.notes.create()).id,
  }));

  it("passes a procedure that refuses a non-owner", async () => {
    await expectOtherUsersRowRefused("notes.getOwned", othersNote.makeInput, callers);
  });

  it("fails a procedure that hands one user another user's row", async () => {
    // Catches: an ownership assertion that passes whatever the procedure does.
    await expect(
      expectOtherUsersRowRefused("notes.getLeaky", othersNote.makeInput, callers)
    ).rejects.toThrow("notes.getLeaky with another user's row, as a user who does not own it");
  });

  it("fails a case whose input does not name the row it made", async () => {
    // Catches: a case that passes because its input is wrong (a NOT_FOUND for
    // a row that never existed) rather than because ownership was checked.
    await expect(
      expectOtherUsersRowRefused("notes.getNothing", othersNote.makeInput, callers)
    ).rejects.toThrow("notes.getNothing with the same input, as the row's owner");
  });

  it("the no-id check finds an id field however it is named, nested or wrapped", () => {
    // Catches: a walker that misses ids inside nested structs, arrays,
    // optionals or structs with defaults, so "takes no id" passes on trust.
    expect(idFieldsIn(inputAstsOf(fixtureRouter)["notes.getOwned"])).toEqual(["noteId"]);
    expect(
      idFieldsIn([
        Schema.Struct({
          id: Schema.String,
          data: Schema.Struct({ ownerId: Schema.String }),
          userIds: Schema.Array(Schema.String),
          targetId: Schema.optional(Schema.String),
          page: Schema.optionalWith(Schema.Number, { default: () => 0 }),
          // Not ids: the rule is camel-case `Id`, not any "id" in a word.
          paid: Schema.Boolean,
          email: Schema.String,
        }).ast,
      ])
    ).toEqual(["data.ownerId", "id", "targetId", "userIds"]);
  });
});
