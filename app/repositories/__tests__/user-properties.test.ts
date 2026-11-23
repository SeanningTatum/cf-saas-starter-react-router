import { expect } from "vitest";
import { it } from "@effect/vitest";
import { Arbitrary, Effect, FastCheck as fc, Layer } from "effect";
import { session, user } from "@/db/schema";
import { getScenario } from "@/lib/fixtures/scenarios";
import type { UserFixture } from "@/lib/fixtures/schema";
import { GetUsersInput, Role, Status } from "@/lib/schemas/user";
import { Database } from "@/services/database";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { UserRepository } from "../user";

const scenario = Effect.runSync(getScenario("many-users"));
const allIds = scenario.users.map((u) => u.id);
const nonAdminIds = scenario.users.filter((u) => u.role !== "admin").map((u) => u.id);
const roleOf = new Map(scenario.users.map((u) => [u.id, u.role]));
const REASON = "property ban";
const FAR_AHEAD = new Date("2999-01-01T00:00:00Z");
const SESSION_UPDATED_AT = new Date("2026-01-01T00:00:00Z");
const WILDCARD_TERMS = ["%", "_", "%user%", "user_0", "Preview%", "%@preview.local"];
const READ_RUNS = { seed: 4747, numRuns: 150 };
const WRITE_RUNS = { seed: 4748, numRuns: 25 };

const seeded = () =>
  UserRepository.Default.pipe(Layer.provideMerge(makeSeededDatabase("many-users")));

const foldAscii = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

const containsLiterally = (text: string, term: string) => foldAscii(text).includes(foldAscii(term));

const statusHolds: Readonly<Record<Status, (u: UserFixture) => boolean>> = {
  banned: (u) => u.banned,
  verified: (u) => u.emailVerified,
  unverified: (u) => !u.emailVerified,
};

const oracle = (input: GetUsersInput) => {
  const { search, role, status } = input;
  const kept = scenario.users.filter(
    (u) =>
      (!search || containsLiterally(u.name, search) || containsLiterally(u.email, search)) &&
      (role === undefined || u.role === role) &&
      (status === undefined || statusHolds[status](u)),
  );
  const start = input.page * input.limit;
  const ids = [...kept]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(start, start + input.limit)
    .map((u) => u.id);
  return { ids, total: kept.length };
};

const fragment = fc
  .constantFrom(...scenario.users.flatMap((u) => [u.name, u.email]))
  .chain((text) =>
    fc
      .tuple(fc.nat({ max: text.length }), fc.nat({ max: text.length }))
      .map(([a, b]) => text.slice(Math.min(a, b), Math.max(a, b))),
  );

const mixedCase = (term: string) =>
  fc
    .array(fc.boolean(), { minLength: term.length, maxLength: term.length })
    .map((flips) =>
      [...term].map((c, i) => (flips[i] ? c.toUpperCase() : c.toLowerCase())).join(""),
    );

const searchTerm = fc.oneof(fragment.chain(mixedCase), fc.constantFrom(...WILDCARD_TERMS));

const focusedInput = fc.integer({ min: 1, max: scenario.users.length + 1 }).chain((limit) =>
  fc.record(
    {
      limit: fc.constant(limit),
      page: fc.nat({ max: Math.ceil(scenario.users.length / limit) }),
      search: searchTerm,
      role: Arbitrary.make(Role),
      status: Arbitrary.make(Status),
    },
    { requiredKeys: ["limit", "page"] },
  ),
);

const expectMatchesOracle = (input: GetUsersInput) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository;
    const result = yield* repo.getUsers(input);
    const expected = oracle(input);
    expect(result.users.map((u) => u.id)).toEqual(expected.ids);
    expect(result.total).toBe(expected.total);
    expect(result.totalPages).toBe(Math.ceil(expected.total / input.limit));
  });

const startSessions = (userIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (userIds.length === 0) return;
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

const snapshot = Effect.gen(function* () {
  const { db } = yield* Database;
  const users = yield* Effect.promise(() =>
    db.select({ id: user.id, banned: user.banned, banReason: user.banReason }).from(user),
  );
  const sessions = yield* Effect.promise(() => db.select({ userId: session.userId }).from(session));
  return { users, sessionOwners: sessions.map((s) => s.userId).sort() };
});

it.layer(seeded())("UserRepository properties on a shared many-users database", (it) => {
  it.effect.prop(
    "getUsers matches the plain-JS oracle for any schema-valid input, so paging, order, total or a filter cannot drift from the spec",
    { input: GetUsersInput },
    ({ input }) => expectMatchesOracle(input),
    { fastCheck: READ_RUNS },
  );

  it.effect.prop(
    "getUsers matches the oracle for mixed-case fragments of real names and emails and for wildcard-looking terms, so search stays case-blind and literal",
    { input: focusedInput },
    ({ input }) => expectMatchesOracle(input),
    { fastCheck: READ_RUNS },
  );

  it.effect.prop(
    "filterProtectedUsers keeps exactly the existing non-admin ids other than the actor and counts the rest as skipped, so a bulk action never reaches an admin, the actor or a ghost id",
    {
      known: fc.shuffledSubarray(allIds),
      unknown: fc.uniqueArray(
        fc.string({ minLength: 1, maxLength: 8 }).map((s) => `ghost-${s}`),
        { maxLength: 4 },
      ),
      actor: fc.constantFrom(...allIds),
    },
    ({ known, unknown, actor }) =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const userIds = [...known, ...unknown];
        const result = yield* repo.filterProtectedUsers({ userIds, currentUserId: actor });
        const expected = known.filter((id) => roleOf.get(id) !== "admin" && id !== actor);
        expect([...result.validUserIds].sort()).toEqual([...expected].sort());
        expect(result.skippedCount).toBe(userIds.length - expected.length);
      }),
    { fastCheck: READ_RUNS },
  );
});

it.effect.prop(
  "bulkBanUsers bans exactly the listed rows and ends exactly their sessions, so a bulk ban neither misses a target nor touches a bystander",
  {
    targets: fc.shuffledSubarray(nonAdminIds, { minLength: 1 }),
    signedIn: fc.subarray(allIds),
  },
  ({ targets, signedIn }) =>
    Effect.gen(function* () {
      const repo = yield* UserRepository;
      yield* startSessions(signedIn);
      expect(yield* repo.bulkBanUsers({ userIds: targets, reason: REASON })).toBe(targets.length);
      const after = yield* snapshot;
      const targeted = new Set(targets);
      const expectedRows = scenario.users.map((u) =>
        targeted.has(u.id)
          ? { id: u.id, banned: true, banReason: REASON }
          : { id: u.id, banned: u.banned, banReason: u.banReason },
      );
      const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
      expect([...after.users].sort(byId)).toEqual(expectedRows.sort(byId));
      expect(after.sessionOwners).toEqual(signedIn.filter((id) => !targeted.has(id)).sort());
    }).pipe(Effect.provide(seeded())),
  { fastCheck: WRITE_RUNS },
);
