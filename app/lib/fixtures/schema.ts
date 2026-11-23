import { Schema } from "effect";
import {
  FIXTURE_ROLES,
  SCENARIO_NAMES,
  SEED_EMAIL_PATTERN,
  SEED_ID_PREFIX,
} from "@/lib/constants/fixtures";
import { Role } from "@/lib/schemas/user";

export const ScenarioName = Schema.Literal(...SCENARIO_NAMES);
export type ScenarioName = typeof ScenarioName.Type;

const FixtureRole = Schema.Literal(...FIXTURE_ROLES);

export const UserFixture = Schema.Struct({
  id: Schema.String.pipe(Schema.startsWith(SEED_ID_PREFIX)),
  name: Schema.NonEmptyTrimmedString,
  email: Schema.String.pipe(Schema.pattern(SEED_EMAIL_PATTERN)),
  role: Role,
  emailVerified: Schema.Boolean,
  banned: Schema.Boolean,
  banReason: Schema.NullOr(Schema.String),
  createdAtMs: Schema.Number.pipe(Schema.int()),
  fixtureRole: Schema.optional(FixtureRole),
});
export type UserFixture = typeof UserFixture.Type;

const firstRepeat = (values: ReadonlyArray<string>): string | undefined =>
  values.find((value, index) => values.indexOf(value) !== index);

const repeatedField = (users: ReadonlyArray<UserFixture>): string | true => {
  const id = firstRepeat(users.map((u) => u.id));
  if (id !== undefined) return `two fixtures share the id ${id}`;
  const email = firstRepeat(users.map((u) => u.email));
  return email === undefined ? true : `two fixtures share the email ${email}`;
};

export const Scenario = Schema.Struct({
  name: ScenarioName,
  description: Schema.String,
  users: Schema.Array(UserFixture),
}).pipe(Schema.filter((scenario) => repeatedField(scenario.users)));
export type Scenario = typeof Scenario.Type;
