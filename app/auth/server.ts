import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

export const drizzleConfig = {
  emailAndPassword: {
    enabled: true,
  },
};

export async function createAuth(database: D1Database, secret: string) {
  const db = await getDb(database);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    secret,
    ...drizzleConfig,
  });
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;
