import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";
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
    // getSession never reads `banned`, so any write that sets it must end the
    // user's sessions. The admin plugin does that on its own routes; this hook
    // covers every other write. It runs after the write, not with it: the
    // repository's batch is atomic, this is not.
    databaseHooks: {
      user: {
        update: {
          after: async (user) => {
            if (user?.banned !== true) return;
            await db.delete(schema.session).where(eq(schema.session.userId, user.id));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
