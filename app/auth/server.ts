import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { admin } from "better-auth/plugins";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import {
  CLIENT_IP_HEADER,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SESSION_COOKIE_SAME_SITE,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/lib/constants/auth";
import type { AuthConfig } from "./config";
import { adminGuard } from "./admin-guard";
import { clearExpiryOnOpenBan, endSessionsOnBan } from "./ban-hooks";

const authOptions = {
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
  },
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    cookieCache: { enabled: false },
  },
  plugins: [admin()],
} satisfies BetterAuthOptions;

export function createAuth(database: D1Database, config: AuthConfig) {
  const db = getDb(database);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: [...config.trustedOrigins],
    ...authOptions,
    advanced: {
      disableOriginCheck: false,
      useSecureCookies: config.secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: SESSION_COOKIE_SAME_SITE,
        secure: config.secureCookies,
      },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    hooks: { before: adminGuard },
    databaseHooks: {
      user: {
        update: {
          before: clearExpiryOnOpenBan,
          after: endSessionsOnBan(db),
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
