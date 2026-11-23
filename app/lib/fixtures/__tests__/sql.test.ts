import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SEED_DELETE_ACCOUNTS_SQL,
  SEED_DELETE_SESSIONS_SQL,
  SEED_DELETE_USERS_SQL,
  SEED_ID_LIKE,
  SEED_INSERT_ACCOUNT_SQL,
  SEED_INSERT_USER_SQL,
} from "@/lib/constants/fixtures";
import { getScenario } from "../scenarios";
import { buildScenarioStatements, renderSqlFile, type SqlStatement } from "../sql";

const HASH = "scrypt:o'hash";
const MIGRATION = resolve(__dirname, "../../../../drizzle/0000_init.sql");
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

const statementsFor = (name: "base" | "many-users") =>
  buildScenarioStatements(Effect.runSync(getScenario(name)), { passwordHash: HASH });

const placeholders = (sql: string): number => sql.split("?").length - 1;

describe("buildScenarioStatements", () => {
  it("deletes seed sessions, accounts and users first, then inserts every user before any account, so the account foreign key holds", () => {
    const statements = statementsFor("many-users");
    expect(statements.slice(0, 3)).toEqual([
      { sql: SEED_DELETE_SESSIONS_SQL, args: [SEED_ID_LIKE] },
      { sql: SEED_DELETE_ACCOUNTS_SQL, args: [SEED_ID_LIKE] },
      { sql: SEED_DELETE_USERS_SQL, args: [SEED_ID_LIKE] },
    ]);
    const kinds = statements.slice(3).map((s) => s.sql);
    expect(kinds).toEqual([
      ...Array(50).fill(SEED_INSERT_USER_SQL),
      ...Array(50).fill(SEED_INSERT_ACCOUNT_SQL),
    ]);
  });

  it("binds exactly as many args as each statement has placeholders, so a new column cannot shift every value after it", () => {
    for (const { sql, args } of statementsFor("many-users"))
      expect(args).toHaveLength(placeholders(sql));
  });

  it("writes booleans as 1 and 0 and the given hash on every account", () => {
    const statements = statementsFor("many-users");
    const userArgs = (id: string) =>
      statements.find((s) => s.sql === SEED_INSERT_USER_SQL && s.args[0] === id)?.args;
    expect(userArgs("seed-banned")?.slice(3, 6)).toEqual([1, "user", 1]);
    expect(userArgs("seed-admin")?.slice(3, 6)).toEqual([1, "admin", 0]);
    expect(userArgs("seed-user-005")?.[3]).toBe(0);
    const accounts = statements.filter((s) => s.sql === SEED_INSERT_ACCOUNT_SQL);
    expect(accounts.every((s) => s.args[4] === HASH)).toBe(true);
  });
});

describe("renderSqlFile", () => {
  it("inlines values: doubles a single quote, writes null as NULL, keeps a ? inside a value, one statement per line", () => {
    const statements: SqlStatement[] = [
      { sql: "INSERT INTO t (a, b, c, d) VALUES (?, ?, ?, ?)", args: ["O'Brien", null, 1, "who?"] },
      { sql: "DELETE FROM t WHERE a LIKE ?", args: ["seed-%"] },
    ];
    expect(renderSqlFile(statements)).toBe(
      "INSERT INTO t (a, b, c, d) VALUES ('O''Brien', NULL, 1, 'who?');\nDELETE FROM t WHERE a LIKE 'seed-%';\n",
    );
  });

  it("has no BEGIN or COMMIT, which D1 rejects in a --file: one file runs as one D1 batch", () => {
    const text = renderSqlFile(statementsFor("many-users"));
    expect(text).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|TRANSACTION)\b/i);
    expect(text.trimEnd().split("\n")).toHaveLength(103);
    expect(
      text
        .trimEnd()
        .split("\n")
        .every((line) => line.endsWith(";")),
    ).toBe(true);
  });
});

describe("rendered SQL against SQLite", () => {
  let client: Client;

  const rows = async (sql: string) => {
    const result = await client.execute(sql);
    return result.rows.map((row) => result.columns.map((column) => row[column]));
  };

  const snapshot = async () => ({
    users: await rows("SELECT * FROM user ORDER BY id"),
    accounts: await rows("SELECT * FROM account ORDER BY id"),
    sessions: await rows("SELECT * FROM session ORDER BY id"),
  });

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    await client.execute("PRAGMA foreign_keys = ON");
    for (const sql of readFileSync(MIGRATION, "utf8").split(STATEMENT_BREAKPOINT)) {
      if (sql.trim() !== "") await client.execute(sql);
    }
    await client.executeMultiple(
      [
        "INSERT INTO user (id, name, email, updated_at) VALUES ('u-real', 'Real', 'real@example.com', 1)",
        "INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('s-real', 9, 't-real', 1, 'u-real')",
        "INSERT INTO account (id, account_id, provider_id, user_id, updated_at) VALUES ('a-real', 'u-real', 'credential', 'u-real', 1)",
      ].join(";\n"),
    );
  });

  afterEach(() => {
    client.close();
  });

  it("restores base over many-users: only base seed rows remain, seed sessions go, the real user's rows stay, and a second restore changes nothing", async () => {
    const before = await snapshot();
    await client.executeMultiple(renderSqlFile(statementsFor("many-users")));
    await client.execute(
      "INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('s-seed', 9, 't-seed', 1, 'seed-user-007')",
    );
    await client.execute(
      "INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('s-admin', 9, 't-admin', 1, 'seed-admin')",
    );

    await client.executeMultiple(renderSqlFile(statementsFor("base")));

    expect(await rows("SELECT id FROM user WHERE id LIKE 'seed-%' ORDER BY id")).toEqual([
      ["seed-admin"],
      ["seed-banned"],
      ["seed-user"],
    ]);
    expect(
      await rows(
        "SELECT id, user_id, password FROM account WHERE user_id LIKE 'seed-%' ORDER BY id",
      ),
    ).toEqual([
      ["seed-admin-account", "seed-admin", HASH],
      ["seed-banned-account", "seed-banned", HASH],
      ["seed-user-account", "seed-user", HASH],
    ]);
    expect(await rows("SELECT id FROM session WHERE user_id LIKE 'seed-%'")).toEqual([]);
    expect(
      await rows(
        "SELECT email, role, email_verified, banned, ban_reason FROM user WHERE id = 'seed-banned'",
      ),
    ).toEqual([["banned@preview.local", "user", 1, 1, "Seeded fixture for ban UI testing"]]);

    const real = (snap: typeof before) => ({
      users: snap.users.filter((r) => r[0] === "u-real"),
      accounts: snap.accounts.filter((r) => r[0] === "a-real"),
      sessions: snap.sessions.filter((r) => r[0] === "s-real"),
    });
    const afterFirst = await snapshot();
    expect(real(afterFirst)).toEqual(real(before));
    expect(real(afterFirst).sessions).toHaveLength(1);

    await client.executeMultiple(renderSqlFile(statementsFor("base")));
    expect(await snapshot()).toEqual(afterFirst);
  });
});
