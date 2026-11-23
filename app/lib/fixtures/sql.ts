import {
  ACCOUNT_ID_SUFFIX,
  CREDENTIAL_PROVIDER_ID,
  SEED_DELETE_ACCOUNTS_SQL,
  SEED_DELETE_SESSIONS_SQL,
  SEED_DELETE_USERS_SQL,
  SEED_ID_LIKE,
  SEED_INSERT_ACCOUNT_SQL,
  SEED_INSERT_USER_SQL,
  SQL_ESCAPED_QUOTE,
  SQL_NULL,
  SQL_PLACEHOLDER,
  SQL_QUOTE,
  SQL_STATEMENT_END,
} from "@/lib/constants/fixtures";
import type { Scenario, UserFixture } from "./schema";

export type SqlValue = string | number | null;

export interface SqlStatement {
  readonly sql: string;
  readonly args: ReadonlyArray<SqlValue>;
}

const flag = (value: boolean): number => (value ? 1 : 0);

const insertUser = (user: UserFixture): SqlStatement => ({
  sql: SEED_INSERT_USER_SQL,
  args: [
    user.id,
    user.name,
    user.email,
    flag(user.emailVerified),
    user.role,
    flag(user.banned),
    user.banReason,
    user.createdAtMs,
    user.createdAtMs,
  ],
});

const insertAccount = (user: UserFixture, passwordHash: string): SqlStatement => ({
  sql: SEED_INSERT_ACCOUNT_SQL,
  args: [
    `${user.id}${ACCOUNT_ID_SUFFIX}`,
    user.id,
    CREDENTIAL_PROVIDER_ID,
    user.id,
    passwordHash,
    user.createdAtMs,
    user.createdAtMs,
  ],
});

export const buildScenarioStatements = (
  scenario: Scenario,
  opts: { readonly passwordHash: string },
): ReadonlyArray<SqlStatement> => [
  { sql: SEED_DELETE_SESSIONS_SQL, args: [SEED_ID_LIKE] },
  { sql: SEED_DELETE_ACCOUNTS_SQL, args: [SEED_ID_LIKE] },
  { sql: SEED_DELETE_USERS_SQL, args: [SEED_ID_LIKE] },
  ...scenario.users.map(insertUser),
  ...scenario.users.map((user) => insertAccount(user, opts.passwordHash)),
];

const literal = (value: SqlValue): string => {
  if (value === null) return SQL_NULL;
  if (typeof value === "number") return String(value);
  return `${SQL_QUOTE}${value.replaceAll(SQL_QUOTE, SQL_ESCAPED_QUOTE)}${SQL_QUOTE}`;
};

const inline = ({ sql, args }: SqlStatement): string =>
  sql
    .split(SQL_PLACEHOLDER)
    .map((part, index) => (index === 0 ? part : `${literal(args[index - 1] ?? null)}${part}`))
    .join("");

export const renderSqlFile = (statements: ReadonlyArray<SqlStatement>): string =>
  statements.map((statement) => `${inline(statement)}${SQL_STATEMENT_END}\n`).join("");
