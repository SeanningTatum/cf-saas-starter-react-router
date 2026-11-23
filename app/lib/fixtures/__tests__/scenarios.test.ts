import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import {
  FIXTURE_EPOCH_MS,
  FIXTURE_HOUR_MS,
  GENERATED_BANNED_EVERY,
  GENERATED_UNVERIFIED_EVERY,
  GENERATED_USER_COUNT,
  SCENARIO_NAMES,
} from "@/lib/constants/fixtures";
import { FixtureValidationError } from "@/models/errors/fixture";
import { RAW_SCENARIOS, decodeScenario, getScenario, isScenarioName } from "../scenarios";

const ADMIN_USERS_PAGE_SIZE = 10;
const GENERATED_ID = /^seed-user-(\d+)$/;

const generatedNumber = (id: string): number | undefined => {
  const match = GENERATED_ID.exec(id);
  return match ? Number(match[1]) : undefined;
};

const failureOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<E> =>
  Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();

describe("scenarios", () => {
  it.effect(
    "decodes every scenario under its own name, so no --scenario value fails at seed time",
    () =>
      Effect.gen(function* () {
        for (const name of SCENARIO_NAMES) {
          const scenario = yield* getScenario(name);
          expect(scenario.name).toBe(name);
        }
      }),
  );

  it.effect(
    "keeps base's ids and emails fixed, since the e2e specs and the agent harness sign in with them",
    () =>
      Effect.gen(function* () {
        const base = yield* getScenario("base");
        expect(base.users.map((u) => [u.id, u.email, u.fixtureRole])).toEqual([
          ["seed-admin", "admin@preview.local", "admin"],
          ["seed-user", "user@preview.local", "user"],
          ["seed-banned", "banned@preview.local", "banned"],
        ]);
        expect(base.users.find((u) => u.id === "seed-admin")?.role).toBe("admin");
        expect(base.users.find((u) => u.id === "seed-banned")?.banned).toBe(true);
      }),
  );

  it.effect("leaves empty with no users at all", () =>
    Effect.gen(function* () {
      expect((yield* getScenario("empty")).users).toEqual([]);
    }),
  );

  it.effect(
    "gives many-users 50 users, five pages at the default page size, banning every 9th and unverifying every 5th generated user plus seed-banned",
    () =>
      Effect.gen(function* () {
        const { users } = yield* getScenario("many-users");
        expect(users).toHaveLength(50);
        expect(Math.ceil(users.length / ADMIN_USERS_PAGE_SIZE)).toBe(5);
        expect(users.slice(0, 3).map((u) => u.id)).toEqual([
          "seed-admin",
          "seed-user",
          "seed-banned",
        ]);

        const generated = users.flatMap((u) => {
          const n = generatedNumber(u.id);
          return n === undefined ? [] : [{ n, user: u }];
        });
        expect(generated.map(({ n }) => n)).toEqual(
          Array.from({ length: GENERATED_USER_COUNT }, (_, i) => i + 1),
        );
        for (const { n, user } of generated) {
          expect(user.banned).toBe(n % GENERATED_BANNED_EVERY === 0);
          expect(user.banReason !== null).toBe(user.banned);
          expect(user.emailVerified).toBe(n % GENERATED_UNVERIFIED_EVERY !== 0);
          expect(user.fixtureRole).toBeUndefined();
        }
        expect(users.filter((u) => u.banned)).toHaveLength(6);
        expect(users.filter((u) => !u.emailVerified)).toHaveLength(9);
      }),
  );

  it.effect(
    "takes every timestamp from FIXTURE_EPOCH_MS, never the clock, so two restores write identical rows",
    () =>
      Effect.gen(function* () {
        const first = yield* getScenario("many-users");
        const second = yield* getScenario("many-users");
        expect(second).toEqual(first);
        expect(first.users[0]?.createdAtMs).toBe(FIXTURE_EPOCH_MS);
        for (const user of first.users) {
          expect(user.createdAtMs).toBeGreaterThanOrEqual(FIXTURE_EPOCH_MS);
          expect(user.createdAtMs).toBeLessThanOrEqual(
            FIXTURE_EPOCH_MS + GENERATED_USER_COUNT * FIXTURE_HOUR_MS,
          );
        }
      }),
  );
});

describe("decodeScenario", () => {
  it.effect(
    "fails a broken fixture with FixtureValidationError naming the scenario and the fixture's id, so the seed log points at the row",
    () =>
      Effect.gen(function* () {
        const raw = RAW_SCENARIOS["many-users"];
        const users = raw.users.map((u, i) =>
          i === 10 ? { ...u, email: "someone@example.com" } : u,
        );
        const failure = failureOf(
          yield* Effect.exit(decodeScenario("many-users", { ...raw, users })),
        );
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(FixtureValidationError);
          expect(failure.value.scenario).toBe("many-users");
          expect(failure.value.fixture).toBe(raw.users[10]?.id);
          expect(failure.value.message).toContain("email");
        }
      }),
  );

  it.effect("fails a duplicate id with FixtureValidationError whose message names the id", () =>
    Effect.gen(function* () {
      const raw = RAW_SCENARIOS.base;
      const [admin] = raw.users;
      const failure = failureOf(
        yield* Effect.exit(
          decodeScenario("base", {
            ...raw,
            users: [...raw.users, { ...admin, email: "x@preview.local" }],
          }),
        ),
      );
      expect(
        Option.map(failure, (e) => e instanceof FixtureValidationError && e.scenario === "base"),
      ).toEqual(Option.some(true));
      expect(Option.map(failure, (e) => e.message.includes("seed-admin"))).toEqual(
        Option.some(true),
      );
    }),
  );
});

describe("isScenarioName", () => {
  it("accepts exactly the scenario names, so --scenario rejects a typo instead of seeding nothing", () => {
    for (const name of SCENARIO_NAMES) expect(isScenarioName(name)).toBe(true);
    for (const name of ["Base", "many_users", "", "base ", undefined, 1])
      expect(isScenarioName(name)).toBe(false);
  });
});
