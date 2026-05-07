import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { admin } from "better-auth/plugins";
import { getDb } from "@/db";
import * as schema from "@/db/schema";

export const drizzleConfig = {
  emailAndPassword: {
    enabled: true,
  },
  plugins: [admin()],
} satisfies BetterAuthOptions;

export function createAuth(
  database: D1Database,
  secret: string,
  baseURL?: string
) {
  const db = getDb(database);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    secret,
    baseURL,
    ...drizzleConfig,
  });
}

export type Auth = ReturnType<typeof createAuth>;
