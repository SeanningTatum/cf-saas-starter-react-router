import { Context, Effect, Layer } from "effect";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { CloudflareEnv } from "./cloudflare";
import { ConfigurationError } from "@/models/errors/repository";

export type DrizzleD1 = ReturnType<typeof drizzleD1<typeof schema>>;

export interface DatabaseShape {
  readonly db: DrizzleD1;
}

export class Database extends Context.Tag("app/Database")<
  Database,
  DatabaseShape
>() {}

export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    if (!env.DATABASE) {
      return yield* Effect.fail(
        new ConfigurationError({
          service: "Database",
          field: "DATABASE",
        })
      );
    }
    return { db: drizzleD1(env.DATABASE, { schema, logger: false }) };
  })
);
