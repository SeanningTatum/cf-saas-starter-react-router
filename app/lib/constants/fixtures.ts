export const SCENARIO_NAMES = ["base", "empty", "many-users"] as const;
export const DEFAULT_SCENARIO = "base";
export const FIXTURE_ROLES = ["admin", "user", "banned"] as const;

export const SEED_ID_PREFIX = "seed-";
export const SEED_ID_LIKE = "seed-%";
export const SEED_EMAIL_DOMAIN = "preview.local";
export const SEED_EMAIL_PATTERN = /^[^@\s]+@preview\.local$/;

export const FIXTURE_EPOCH_MS = 1_767_225_600_000;
export const FIXTURE_MINUTE_MS = 60_000;
export const FIXTURE_HOUR_MS = 3_600_000;

export const FIXTURE_ROLE_EMAILS = {
  admin: "admin@preview.local",
  user: "user@preview.local",
  banned: "banned@preview.local",
} as const;

export const BASE_USERS = [
  {
    id: "seed-admin",
    name: "Admin Preview",
    email: FIXTURE_ROLE_EMAILS.admin,
    role: "admin",
    emailVerified: true,
    banned: false,
    banReason: null,
    fixtureRole: "admin",
  },
  {
    id: "seed-user",
    name: "User Preview",
    email: FIXTURE_ROLE_EMAILS.user,
    role: "user",
    emailVerified: true,
    banned: false,
    banReason: null,
    fixtureRole: "user",
  },
  {
    id: "seed-banned",
    name: "Banned Preview",
    email: FIXTURE_ROLE_EMAILS.banned,
    role: "user",
    emailVerified: true,
    banned: true,
    banReason: "Seeded fixture for ban UI testing",
    fixtureRole: "banned",
  },
] as const;

export const GENERATED_USER_COUNT = 47;
export const GENERATED_ID_DIGITS = 3;
export const GENERATED_UNVERIFIED_EVERY = 5;
export const GENERATED_BANNED_EVERY = 9;

export const SCENARIO_DESCRIPTIONS = {
  base: "The three login roles: admin, user and a banned user.",
  empty: "No users at all, for empty states. It leaves no account to sign in with.",
  "many-users":
    "The three login roles plus 47 generated users: every 5th unverified, every 9th banned.",
} as const;

export const CREDENTIAL_PROVIDER_ID = "credential";
export const ACCOUNT_ID_SUFFIX = "-account";

export const SEED_DELETE_UPLOADS_SQL = "DELETE FROM upload WHERE user_id LIKE ?";
export const SEED_DELETE_SESSIONS_SQL = "DELETE FROM session WHERE user_id LIKE ?";
export const SEED_DELETE_ACCOUNTS_SQL = "DELETE FROM account WHERE user_id LIKE ?";
export const SEED_DELETE_USERS_SQL = "DELETE FROM user WHERE id LIKE ?";
export const SEED_INSERT_USER_SQL =
  "INSERT INTO user (id, name, email, email_verified, role, banned, ban_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
export const SEED_INSERT_ACCOUNT_SQL =
  "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
export const SEED_INSERT_UPLOAD_SQL =
  "INSERT INTO upload (id, user_id, key, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)";
export const UPLOAD_ID_SUFFIX = "-upload";
export const SEED_UPLOAD_CONTENT_TYPE = "image/png";
export const SEED_UPLOAD_SIZE_BYTES = 2048;
export const SQL_PLACEHOLDER = "?";
export const SQL_NULL = "NULL";
export const SQL_QUOTE = "'";
export const SQL_ESCAPED_QUOTE = "''";
export const SQL_STATEMENT_END = ";";

export const SEEDED_DATABASE_URL = ":memory:";
export const SEEDED_DATABASE_PASSWORD_HASH = "not-a-hash:the-seeded-test-database-has-no-login";
export const SQLITE_FOREIGN_KEYS_ON = "PRAGMA foreign_keys = ON";
export const MIGRATION_STATEMENT_BREAKPOINT = "--> statement-breakpoint";
