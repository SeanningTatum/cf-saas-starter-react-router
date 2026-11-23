import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { count, eq } from "drizzle-orm";
import { Effect, Exit, Layer, Scope } from "effect";
import { account, session, user } from "@/db/schema";
import { getScenario } from "@/lib/fixtures/scenarios";
import type { Scenario } from "@/lib/fixtures/schema";
import { SeedError } from "@/models/errors/fixture";
import { Database } from "../database";
import { makeSeededDatabase, migrationStatements } from "../database.seeded-layer";

const SEED_USER = "seed-user";
const SESSION_ROW = {
  id: "s-seed-user",
  token: "t-seed-user",
  userId: SEED_USER,
  expiresAt: new Date("2999-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const rowCount = (table: typeof user | typeof account | typeof session) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    const [row] = yield* Effect.promise(() => db.select({ n: count() }).from(table));
    return row?.n ?? 0;
  });

const nameOf = (id: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    const rows = yield* Effect.promise(() =>
      db.select({ name: user.name }).from(user).where(eq(user.id, id)),
    );
    return rows[0]?.name;
  });

describe("makeSeededDatabase", () => {
  it.effect(
    "runs the migrations and the scenario on one connection, so every table and every fixture row is there (a second :memory: connection would be empty)",
    () =>
      Effect.gen(function* () {
        const scenario = yield* getScenario("many-users");
        expect(yield* rowCount(user)).toBe(scenario.users.length);
        expect(yield* rowCount(account)).toBe(scenario.users.length);
        expect(yield* rowCount(session)).toBe(0);
      }).pipe(Effect.provide(makeSeededDatabase("many-users"))),
  );

  it.effect(
    "rolls back a whole drizzle batch when one statement fails, as a D1 batch does, so a batched write is all or nothing",
    () =>
      Effect.gen(function* () {
        const { db } = yield* Database;
        const before = yield* nameOf(SEED_USER);
        const exit = yield* Effect.exit(
          Effect.tryPromise(() =>
            db.batch([
              db.update(user).set({ name: "Renamed" }).where(eq(user.id, SEED_USER)),
              db.update(user).set({ email: "admin@preview.local" }).where(eq(user.id, SEED_USER)),
            ]),
          ),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* nameOf(SEED_USER)).toBe(before);
      }).pipe(Effect.provide(makeSeededDatabase("base"))),
  );

  it.effect(
    "keeps foreign keys on, as D1 does, so deleting a user also deletes its account and sessions",
    () =>
      Effect.gen(function* () {
        const { db } = yield* Database;
        yield* Effect.promise(() => db.insert(session).values(SESSION_ROW));
        yield* Effect.promise(() => db.delete(user).where(eq(user.id, SEED_USER)));
        const left = yield* Effect.promise(() =>
          db.select({ id: account.id }).from(account).where(eq(account.userId, SEED_USER)),
        );
        expect(left).toEqual([]);
        expect(yield* rowCount(session)).toBe(0);
      }).pipe(Effect.provide(makeSeededDatabase("base"))),
  );

  it.effect(
    "gives every Effect.provide its own database, so a write in one test never leaks into the next",
    () =>
      Effect.gen(function* () {
        const layer = makeSeededDatabase("base");
        yield* Effect.gen(function* () {
          const { db } = yield* Database;
          yield* Effect.promise(() => db.delete(user));
          expect(yield* rowCount(user)).toBe(0);
        }).pipe(Effect.provide(layer));
        const base = yield* getScenario("base");
        expect(yield* rowCount(user).pipe(Effect.provide(layer))).toBe(base.users.length);
      }),
  );

  it.effect("closes the client when its scope ends, so a test file cannot leak connections", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(makeSeededDatabase("empty"), scope);
      const { db } = yield* Effect.provide(Database, context);
      yield* Scope.close(scope, Exit.void);
      const exit = yield* Effect.exit(Effect.tryPromise(() => db.select().from(user)));
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("seeds a hand-built Scenario, so a test can ask for exactly the rows it needs", () => {
    const scenario: Scenario = {
      name: "empty",
      description: "one user",
      users: [
        {
          id: "seed-only",
          name: "Only",
          email: "only@preview.local",
          role: "user",
          emailVerified: false,
          banned: false,
          banReason: null,
          createdAtMs: 0,
        },
      ],
    };
    return Effect.gen(function* () {
      expect(yield* rowCount(user)).toBe(1);
      expect(yield* nameOf("seed-only")).toBe("Only");
    }).pipe(Effect.provide(makeSeededDatabase(scenario)));
  });

  it.effect(
    "fails with SeedError (target memory, scenario named) when the rows break a constraint, instead of handing a test a half-seeded database",
    () =>
      Effect.gen(function* () {
        const base = yield* getScenario("base");
        const [admin] = base.users;
        const broken: Scenario = admin
          ? { ...base, users: [...base.users, { ...admin, id: "seed-twin" }] }
          : base;
        const error = yield* Effect.flip(
          Layer.build(makeSeededDatabase(broken)).pipe(Effect.scoped),
        );
        expect(error).toBeInstanceOf(SeedError);
        expect(error).toMatchObject({ target: "memory", scenario: "base" });
      }),
  );
});

describe("migrationStatements", () => {
  const journal = { entries: [{ tag: "0000_a" }, { tag: "0001_b" }] };

  it.effect(
    "returns statements in journal order, split on the breakpoint, with blanks dropped",
    () =>
      Effect.gen(function* () {
        const statements = yield* migrationStatements(journal, {
          "/drizzle/0001_b.sql": "CREATE TABLE b (x);",
          "/drizzle/0000_a.sql":
            "CREATE TABLE a (x);\n--> statement-breakpoint\nCREATE INDEX i ON a (x);\n--> statement-breakpoint\n",
        });
        expect(statements).toEqual([
          "CREATE TABLE a (x);",
          "CREATE INDEX i ON a (x);",
          "CREATE TABLE b (x);",
        ]);
      }),
  );

  it.effect(
    "fails when the journal lists a migration whose file is missing, so a test never runs on half a schema",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          migrationStatements(journal, { "/drizzle/0000_a.sql": "CREATE TABLE a (x);" }),
        );
        expect(error.message).toContain("0001_b");
      }),
  );

  it.effect(
    "fails when a .sql file is not in the journal, so the test schema cannot drift from what drizzle applies",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          migrationStatements(journal, {
            "/drizzle/0000_a.sql": "CREATE TABLE a (x);",
            "/drizzle/0001_b.sql": "CREATE TABLE b (x);",
            "/drizzle/0002_stray.sql": "CREATE TABLE c (x);",
          }),
        );
        expect(error.message).toContain("0002_stray");
      }),
  );

  it.effect("fails with SeedError when the journal does not parse", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(migrationStatements({ entries: "nope" }, {}));
      expect(error).toBeInstanceOf(SeedError);
    }),
  );
});
