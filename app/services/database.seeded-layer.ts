import { type Client, createClient, type InStatement } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Effect, Layer, Schema } from "effect";
import * as schema from "@/db/schema";
import {
  MIGRATION_STATEMENT_BREAKPOINT,
  SEEDED_DATABASE_PASSWORD_HASH,
  SEEDED_DATABASE_URL,
  SQLITE_FOREIGN_KEYS_ON,
} from "@/lib/constants/fixtures";
import {
  FIXTURES_APPLY_MIGRATIONS_SPAN,
  FIXTURES_APPLY_SCENARIO_SPAN,
  FIXTURES_OPEN_DATABASE_SPAN,
} from "@/lib/constants/spans";
import { getScenario } from "@/lib/fixtures/scenarios";
import type { Scenario, ScenarioName } from "@/lib/fixtures/schema";
import { buildScenarioStatements } from "@/lib/fixtures/sql";
import { type FixtureValidationError, SeedError } from "@/models/errors/fixture";
import { Database, type DrizzleD1 } from "./database";

const MigrationJournal = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ tag: Schema.String })),
});

const migrationFiles = import.meta.glob<string>("/drizzle/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

const journalFiles = import.meta.glob<unknown>("/drizzle/meta/_journal.json", {
  import: "default",
  eager: true,
});

const memoryError = (scenario: string, message: string, cause?: unknown) =>
  new SeedError({ scenario, target: "memory", message, cause });

const fileFor = (files: Readonly<Record<string, string>>, tag: string): string | undefined =>
  Object.entries(files).find(([path]) => path.endsWith(`/${tag}.sql`))?.[1];

export const migrationStatements = (
  journal: unknown,
  files: Readonly<Record<string, string>>,
): Effect.Effect<ReadonlyArray<string>, SeedError> =>
  Effect.gen(function* () {
    const { entries } = yield* Schema.decodeUnknown(MigrationJournal)(journal).pipe(
      Effect.mapError((cause) =>
        memoryError("migrations", "drizzle/meta/_journal.json does not parse", cause),
      ),
    );
    const tags = entries.map((entry) => entry.tag);
    const orphan = Object.keys(files).find(
      (path) => !tags.some((tag) => path.endsWith(`/${tag}.sql`)),
    );
    if (orphan !== undefined) {
      return yield* Effect.fail(
        memoryError("migrations", `${orphan} is not in drizzle/meta/_journal.json`),
      );
    }
    const statements: string[] = [];
    for (const tag of tags) {
      const sql = fileFor(files, tag);
      if (sql === undefined) {
        return yield* Effect.fail(
          memoryError("migrations", `the journal lists ${tag} but drizzle/${tag}.sql is missing`),
        );
      }
      statements.push(
        ...sql
          .split(MIGRATION_STATEMENT_BREAKPOINT)
          .map((part) => part.trim())
          .filter((part) => part !== ""),
      );
    }
    return statements;
  });

const runBatch = (
  span: string,
  client: Client,
  scenario: string,
  statements: ReadonlyArray<InStatement>,
) =>
  Effect.tryPromise({
    try: () => client.batch([...statements], "write"),
    catch: (cause) => memoryError(scenario, "a batch failed and was rolled back", cause),
  }).pipe(Effect.withSpan(span, { kind: "client", attributes: { scenario } }));

const openClient = (scenario: string) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const client = createClient({ url: SEEDED_DATABASE_URL });
        await client.execute(SQLITE_FOREIGN_KEYS_ON);
        return client;
      },
      catch: (cause) => memoryError(scenario, "could not open the in-memory database", cause),
    }).pipe(Effect.withSpan(FIXTURES_OPEN_DATABASE_SPAN, { kind: "client" })),
    (client) => Effect.sync(() => client.close()),
  );

const applyMigrations = (client: Client, scenario: string) =>
  Effect.gen(function* () {
    const journal = Object.values(journalFiles)[0];
    const statements = yield* migrationStatements(journal, migrationFiles);
    yield* runBatch(FIXTURES_APPLY_MIGRATIONS_SPAN, client, scenario, statements);
  });

const applyScenario = (client: Client, scenario: Scenario) =>
  runBatch(
    FIXTURES_APPLY_SCENARIO_SPAN,
    client,
    scenario.name,
    buildScenarioStatements(scenario, { passwordHash: SEEDED_DATABASE_PASSWORD_HASH }).map(
      ({ sql, args }) => ({ sql, args: [...args] }),
    ),
  );

const resolveScenario = (scenario: ScenarioName | Scenario) =>
  typeof scenario === "string" ? getScenario(scenario) : Effect.succeed(scenario);

export const makeSeededDatabase = (
  scenario: ScenarioName | Scenario,
): Layer.Layer<Database, FixtureValidationError | SeedError> =>
  Layer.scoped(
    Database,
    Effect.gen(function* () {
      const resolved = yield* resolveScenario(scenario);
      const client = yield* openClient(resolved.name);
      yield* applyMigrations(client, resolved.name);
      yield* applyScenario(client, resolved);
      const db = drizzle(client, { schema, logger: false });
      return { db: db as unknown as DrizzleD1 };
    }),
  );
