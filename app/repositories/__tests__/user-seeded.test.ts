import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { account, session, user } from "@/db/schema";
import { getScenario } from "@/lib/fixtures/scenarios";
import type { UserFixture } from "@/lib/fixtures/schema";
import type { GetUsersInput } from "@/lib/schemas/user";
import { NotFoundError, ValidationError } from "@/models/errors/repository";
import { Database } from "@/services/database";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { UserRepository } from "../user";

const scenario = Effect.runSync(getScenario("many-users"));
const ADMIN = "seed-admin";
const PLAIN = "seed-user";
const BANNED = "seed-banned";
const OTHER = "seed-user-001";
const ANOTHER = "seed-user-002";
const GHOST = "ghost-user";
const PAGE_MAX = 100;
const FAR_AHEAD = new Date("2999-01-01T00:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");
const SESSION_UPDATED_AT = new Date("2026-01-01T00:00:00Z");

const seeded = () =>
  UserRepository.Default.pipe(Layer.provideMerge(makeSeededDatabase("many-users")));

const idsOf = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map((row) => row.id);

const scenarioIdsExcept = (gone: ReadonlyArray<string>) =>
  idsOf(scenario.users)
    .filter((id) => !gone.includes(id))
    .sort();

const newestFirst = (users: ReadonlyArray<UserFixture>) =>
  [...users].sort((a, b) => b.createdAtMs - a.createdAtMs);

const firstPageOf = (keep: (u: UserFixture) => boolean) =>
  idsOf(newestFirst(scenario.users.filter(keep)).slice(0, PAGE_MAX));

const contains = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase());

const matchesSearch = (term: string) => (u: UserFixture) =>
  contains(u.name, term) || contains(u.email, term);

const rowOf = (id: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    const rows = yield* Effect.promise(() => db.select().from(user).where(eq(user.id, id)));
    return rows[0];
  });

const ownersOf = (table: typeof session | typeof account) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    const rows = yield* Effect.promise(() => db.select({ userId: table.userId }).from(table));
    return rows.map((row) => row.userId).sort();
  });

const startSessions = (userIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    yield* Effect.promise(() =>
      db.insert(session).values(
        userIds.map((userId) => ({
          id: `s-${userId}`,
          token: `t-${userId}`,
          userId,
          expiresAt: FAR_AHEAD,
          updatedAt: SESSION_UPDATED_AT,
        })),
      ),
    );
  });

const setBanExpires = (id: string, banExpires: Date) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    yield* Effect.promise(() => db.update(user).set({ banExpires }).where(eq(user.id, id)));
  });

type Filter = Pick<GetUsersInput, "search" | "role" | "status">;

const filterCases: ReadonlyArray<readonly [string, Filter, (u: UserFixture) => boolean]> = [
  ["role admin", { role: "admin" }, (u) => u.role === "admin"],
  ["role user", { role: "user" }, (u) => u.role === "user"],
  ["status banned", { status: "banned" }, (u) => u.banned],
  ["status verified", { status: "verified" }, (u) => u.emailVerified],
  ["status unverified", { status: "unverified" }, (u) => !u.emailVerified],
  ["a name fragment", { search: "Preview User 01" }, matchesSearch("Preview User 01")],
  ["an email fragment", { search: "user-007@" }, matchesSearch("user-007@")],
  ["a mixed-case name fragment", { search: "pReViEw uSeR 01" }, matchesSearch("preview user 01")],
  ["an upper-case email fragment", { search: "BANNED@PREVIEW" }, matchesSearch("banned@preview")],
  [
    "search, role and status together",
    { search: "preview user", role: "user", status: "banned" },
    (u) => matchesSearch("preview user")(u) && u.role === "user" && u.banned,
  ],
  ...["%", "_", "%user%", "user_00", "Preview%"].map(
    (term) =>
      [
        `the literal term ${JSON.stringify(term)} (LIKE would read it as a wildcard)`,
        { search: term },
        matchesSearch(term),
      ] as const,
  ),
];

it.layer(seeded())("UserRepository reads on many-users", (it) => {
  it.effect(
    "walks every page newest first with each user once, so an off-by-one offset or a flipped order neither skips nor repeats a row",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const limit = 7;
        const first = yield* repo.getUsers({ page: 0, limit });
        const pages = yield* Effect.forEach(
          Array.from({ length: first.totalPages }, (_, page) => page),
          (page) => repo.getUsers({ page, limit }),
        );
        expect(pages.flatMap((p) => idsOf(p.users))).toEqual(idsOf(newestFirst(scenario.users)));
      }),
  );

  it.effect(
    "counts total and totalPages over the whole filtered table, not the page, so the pager cannot stop early",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const limit = 7;
        const result = yield* repo.getUsers({ page: 1, limit });
        expect(result).toMatchObject({
          total: scenario.users.length,
          totalPages: Math.ceil(scenario.users.length / limit),
          page: 1,
          limit,
        });
        expect(result.users).toHaveLength(limit);
        const past = yield* repo.getUsers({ page: result.totalPages, limit });
        expect(past.users).toEqual([]);
        expect(past.total).toBe(scenario.users.length);
      }),
  );

  for (const [label, filter, keep] of filterCases) {
    it.effect(
      `filters by ${label}, so a dropped, swapped or OR-ed condition returns the wrong users`,
      () =>
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          const result = yield* repo.getUsers({ page: 0, limit: PAGE_MAX, ...filter });
          expect(idsOf(result.users)).toEqual(firstPageOf(keep));
          expect(result.total).toBe(scenario.users.filter(keep).length);
        }),
    );
  }

  it.effect(
    "returns the stored row with createdAt as the fixture's instant, so a timestamp unit mix-up shows",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const expected = scenario.users.find((u) => u.id === BANNED);
        const found = yield* repo.getUser({ userId: BANNED });
        expect(found).toMatchObject({
          id: BANNED,
          email: expected?.email,
          banned: true,
          banReason: expected?.banReason,
          createdAt: new Date(expected?.createdAtMs ?? Number.NaN),
        });
      }),
  );

  it.effect(
    "fails getUser, unbanUser, updateUser and deleteUser with NotFoundError for a missing id, so acting on nobody is a 404, not a success",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const attempts: ReadonlyArray<Effect.Effect<unknown, unknown>> = [
          repo.getUser({ userId: GHOST }),
          repo.unbanUser({ userId: GHOST }),
          repo.updateUser({ userId: GHOST, currentUserId: ADMIN, data: { name: "x" } }),
          repo.deleteUser({ userId: GHOST, currentUserId: ADMIN }),
        ];
        for (const attempt of attempts) {
          expect(yield* Effect.flip(attempt)).toBeInstanceOf(NotFoundError);
        }
      }),
  );

  it.effect(
    "filterProtectedUsers skips admins, the actor and unknown ids, counting all three as skipped, so a bulk action never touches them",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const userIds = [ADMIN, PLAIN, BANNED, OTHER, GHOST];
        const result = yield* repo.filterProtectedUsers({ userIds, currentUserId: OTHER });
        expect([...result.validUserIds].sort()).toEqual([BANNED, PLAIN].sort());
        expect(result.skippedCount).toBe(userIds.length - result.validUserIds.length);
      }),
  );
});

describe("UserRepository bans on many-users", () => {
  it.effect(
    "banUser writes banned, reason and expiry and ends only the target's sessions, so a banned user stays signed out and nobody else is",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        yield* startSessions([PLAIN, OTHER]);
        yield* repo.banUser({
          userId: PLAIN,
          currentUserId: ADMIN,
          reason: "spam",
          expiresAt: FAR_AHEAD,
        });
        expect(yield* rowOf(PLAIN)).toMatchObject({
          banned: true,
          banReason: "spam",
          banExpires: FAR_AHEAD,
        });
        expect(yield* ownersOf(session)).toEqual([OTHER]);
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "banUser refuses an admin target with ValidationError and keeps its sessions, so one admin cannot lock out another",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        yield* startSessions([ADMIN]);
        const error = yield* Effect.flip(repo.banUser({ userId: ADMIN, currentUserId: PLAIN }));
        expect(error).toBeInstanceOf(ValidationError);
        expect(yield* rowOf(ADMIN)).toMatchObject({ banned: false });
        expect(yield* ownersOf(session)).toEqual([ADMIN]);
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "bulkBanUsers bans every listed row with the reason and ends only their sessions, so a bulk ban misses nobody and signs out no bystander",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        yield* startSessions([PLAIN, OTHER, ANOTHER]);
        const n = yield* repo.bulkBanUsers({ userIds: [PLAIN, OTHER], reason: "spam" });
        expect(n).toBe(2);
        for (const id of [PLAIN, OTHER]) {
          expect(yield* rowOf(id)).toMatchObject({
            banned: true,
            banReason: "spam",
            banExpires: null,
          });
        }
        expect(yield* rowOf(ANOTHER)).toMatchObject({ banned: false });
        expect(yield* ownersOf(session)).toEqual([ANOTHER]);
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "unbanUser clears banned, banReason and banExpires, so an old reason or expiry cannot linger on an unbanned user",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        yield* setBanExpires(BANNED, FAR_AHEAD);
        expect(yield* repo.unbanUser({ userId: BANNED })).toEqual({ success: true });
        expect(yield* rowOf(BANNED)).toMatchObject({
          banned: false,
          banReason: null,
          banExpires: null,
        });
      }).pipe(Effect.provide(seeded())),
  );
});

describe("UserRepository.updateUser on many-users", () => {
  it.effect("a rename keeps the user's sessions, so editing a name signs nobody out", () =>
    Effect.gen(function* () {
      const repo = yield* UserRepository;
      yield* startSessions([PLAIN]);
      yield* repo.updateUser({ userId: PLAIN, currentUserId: ADMIN, data: { name: "Renamed" } });
      expect(yield* rowOf(PLAIN)).toMatchObject({ name: "Renamed", banned: false });
      expect(yield* ownersOf(session)).toEqual([PLAIN]);
    }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "banned: true ends the sessions and nulls an old expiry, so the update road cannot leave a live session or a stale past expiry",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        yield* setBanExpires(PLAIN, PAST);
        yield* startSessions([PLAIN, OTHER]);
        yield* repo.updateUser({ userId: PLAIN, currentUserId: ADMIN, data: { banned: true } });
        expect(yield* rowOf(PLAIN)).toMatchObject({ banned: true, banExpires: null });
        expect(yield* ownersOf(session)).toEqual([OTHER]);
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "an email change resets emailVerified, so a new address is never trusted unconfirmed",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        expect(yield* rowOf(PLAIN)).toMatchObject({ emailVerified: true });
        yield* repo.updateUser({
          userId: PLAIN,
          currentUserId: ADMIN,
          data: { email: "renamed@preview.local" },
        });
        expect(yield* rowOf(PLAIN)).toMatchObject({
          email: "renamed@preview.local",
          emailVerified: false,
        });
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "refuses an admin target with ValidationError and leaves the row, so admins cannot edit each other",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const before = yield* rowOf(ADMIN);
        const error = yield* Effect.flip(
          repo.updateUser({ userId: ADMIN, currentUserId: PLAIN, data: { name: "Hijacked" } }),
        );
        expect(error).toBeInstanceOf(ValidationError);
        expect(yield* rowOf(ADMIN)).toEqual(before);
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "refuses the actor's own row with ValidationError, so an admin cannot demote or ban themselves",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const error = yield* Effect.flip(
          repo.updateUser({ userId: PLAIN, currentUserId: PLAIN, data: { role: "admin" } }),
        );
        expect(error).toBeInstanceOf(ValidationError);
        expect(yield* rowOf(PLAIN)).toMatchObject({ role: "user" });
      }).pipe(Effect.provide(seeded())),
  );
});

describe("UserRepository deletes and role changes on many-users", () => {
  it.effect(
    "deleteUser removes the row and cascades to its account and sessions, so no orphan login survives",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        yield* startSessions([PLAIN, OTHER]);
        yield* repo.deleteUser({ userId: PLAIN, currentUserId: ADMIN });
        expect(yield* rowOf(PLAIN)).toBeUndefined();
        expect(yield* ownersOf(account)).toEqual(scenarioIdsExcept([PLAIN]));
        expect(yield* ownersOf(session)).toEqual([OTHER]);
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "deleteUser refuses the actor's own row with ValidationError and keeps it, so an admin cannot delete themselves",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const error = yield* Effect.flip(repo.deleteUser({ userId: PLAIN, currentUserId: PLAIN }));
        expect(error).toBeInstanceOf(ValidationError);
        expect(yield* rowOf(PLAIN)).toBeDefined();
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "bulkDeleteUsers removes exactly the listed rows and their accounts, so a bulk delete neither misses nor over-reaches",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const doomed = [OTHER, ANOTHER];
        expect(yield* repo.bulkDeleteUsers({ userIds: doomed })).toBe(doomed.length);
        const kept = scenarioIdsExcept(doomed);
        const left = yield* repo.getUsers({ page: 0, limit: PAGE_MAX });
        expect(left.total).toBe(kept.length);
        expect(yield* ownersOf(account)).toEqual(kept);
      }).pipe(Effect.provide(seeded())),
  );

  it.effect(
    "bulkUpdateUserRoles sets the role on exactly the listed rows, so a role change cannot spread to other users",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const promoted = [OTHER, ANOTHER];
        expect(yield* repo.bulkUpdateUserRoles({ userIds: promoted, role: "admin" })).toBe(
          promoted.length,
        );
        const admins = yield* repo.getUsers({ page: 0, limit: PAGE_MAX, role: "admin" });
        const isAdminNow = (u: UserFixture) => u.role === "admin" || promoted.includes(u.id);
        expect(idsOf(admins.users)).toEqual(firstPageOf(isAdminNow));
      }).pipe(Effect.provide(seeded())),
  );
});
