import { Effect, ParseResult, Schema } from "effect";
import {
  BASE_USERS,
  FIXTURE_EPOCH_MS,
  FIXTURE_HOUR_MS,
  FIXTURE_MINUTE_MS,
  GENERATED_BANNED_EVERY,
  GENERATED_ID_DIGITS,
  GENERATED_UNVERIFIED_EVERY,
  GENERATED_USER_COUNT,
  SCENARIO_DESCRIPTIONS,
  SEED_EMAIL_DOMAIN,
  SEED_ID_PREFIX,
} from "@/lib/constants/fixtures";
import { FIXTURES_LOAD_SCENARIO_SPAN } from "@/lib/constants/spans";
import { FixtureValidationError } from "@/models/errors/fixture";
import { Scenario, ScenarioName, type UserFixture } from "./schema";

type RawUser = typeof UserFixture.Encoded;
type RawScenario = typeof Scenario.Encoded;

const baseUsers: ReadonlyArray<RawUser> = BASE_USERS.map((user, index) => ({
  ...user,
  createdAtMs: FIXTURE_EPOCH_MS + index * FIXTURE_MINUTE_MS,
}));

const generatedUser = (n: number): RawUser => {
  const num = String(n).padStart(GENERATED_ID_DIGITS, "0");
  const banned = n % GENERATED_BANNED_EVERY === 0;
  return {
    id: `${SEED_ID_PREFIX}user-${num}`,
    name: `Preview User ${num}`,
    email: `user-${num}@${SEED_EMAIL_DOMAIN}`,
    role: "user",
    emailVerified: n % GENERATED_UNVERIFIED_EVERY !== 0,
    banned,
    banReason: banned ? `Seeded ban #${n}` : null,
    createdAtMs: FIXTURE_EPOCH_MS + n * FIXTURE_HOUR_MS,
  };
};

const generatedUsers = Array.from({ length: GENERATED_USER_COUNT }, (_, i) => generatedUser(i + 1));

export const RAW_SCENARIOS: Readonly<Record<ScenarioName, RawScenario>> = {
  base: { name: "base", description: SCENARIO_DESCRIPTIONS.base, users: baseUsers },
  empty: { name: "empty", description: SCENARIO_DESCRIPTIONS.empty, users: [] },
  "many-users": {
    name: "many-users",
    description: SCENARIO_DESCRIPTIONS["many-users"],
    users: [...baseUsers, ...generatedUsers],
  },
};

export const isScenarioName = Schema.is(ScenarioName);

const fixtureNamedBy = (raw: unknown, path: ReadonlyArray<PropertyKey>): string | undefined => {
  const [field, index] = path;
  if (field !== "users" || typeof index !== "number") return undefined;
  const users = (raw as Partial<RawScenario> | undefined)?.users;
  return users?.[index]?.id;
};

const toValidationError =
  (scenario: string, raw: unknown) =>
  (error: ParseResult.ParseError): FixtureValidationError => {
    const [first] = ParseResult.ArrayFormatter.formatErrorSync(error);
    return new FixtureValidationError({
      scenario,
      fixture: first ? fixtureNamedBy(raw, first.path) : undefined,
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    });
  };

export const decodeScenario = (
  name: string,
  raw: unknown,
): Effect.Effect<Scenario, FixtureValidationError> =>
  Schema.decodeUnknown(Scenario)(raw).pipe(Effect.mapError(toValidationError(name, raw)));

export const getScenario = (name: ScenarioName): Effect.Effect<Scenario, FixtureValidationError> =>
  decodeScenario(name, RAW_SCENARIOS[name]).pipe(
    Effect.withSpan(FIXTURES_LOAD_SCENARIO_SPAN, { attributes: { scenario: name } }),
  );
