#!/usr/bin/env bun
// Deterministic fixture seed for local D1 + per-PR preview databases.
//
// Usage:
//   bun scripts/seed-preview.ts              # local D1 (wrangler d1 execute DATABASE --local)
//   bun scripts/seed-preview.ts --preview --pr <N>
//                                             # preview-env D1 (--env preview --remote)
//   bun scripts/seed-preview.ts --remote --force-production
//                                             # top-level prod D1 (refuses without the flag)
//   PREVIEW_SEED_SECRET=... bun scripts/seed-preview.ts --print-password --pr <N>
//                                             # print that preview's password, nothing else
//
// Seeds three Better Auth email/password fixtures (admin / user / banned).
// Fixture rows use fixed `seed-*` ids and `INSERT OR IGNORE`, so this is safe
// to rerun on every `bun run dev` invocation and on every PR synchronize in
// CI — it never overwrites rows a human or test has since modified.
//
// Passwords: local D1 uses `Password123!`; preview and production seeds never
// do. They derive one from a secret (PREVIEW_SEED_SECRET, or
// PRODUCTION_SEED_SECRET for the forced production seed) and never print it.
// How it works and why: docs/ci/pipelines.md#preview-passwords
//
// Rule: every feature adding a table or user-visible data extends these
// fixtures in the same diff.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Either } from "effect";
import { hashPassword } from "better-auth/crypto";

interface Fixture {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  emailVerified: boolean;
  banned: boolean;
  banReason?: string;
}

const PASSWORD = "Password123!";

const FIXTURES: Fixture[] = [
  {
    id: "seed-admin",
    name: "Admin Preview",
    email: "admin@preview.local",
    role: "admin",
    emailVerified: true,
    banned: false,
  },
  {
    id: "seed-user",
    name: "User Preview",
    email: "user@preview.local",
    role: "user",
    emailVerified: true,
    banned: false,
  },
  {
    id: "seed-banned",
    name: "Banned Preview",
    email: "banned@preview.local",
    role: "user",
    emailVerified: true,
    banned: true,
    banReason: "Seeded fixture for ban UI testing",
  },
];

function fail(message: string): never {
  console.error(`\x1b[31m✗ ${message}\x1b[0m`);
  process.exit(1);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface Target {
  /** Extra flags appended to `wrangler d1 execute DATABASE <flags> --file <tmp>`. */
  flags: string[];
  label: string;
  local: boolean;
}

export type Plan =
  | { kind: "describe" }
  | { kind: "print-password"; password: string }
  | { kind: "seed"; target: Target; password: string };

const MIN_SECRET_LENGTH = 16;
const SLUG = /^[a-z0-9][a-z0-9-]*$/i;

/** First 24 chars of base64url(HMAC-SHA256(key = secret, message = `preview:<slug>`)). */
export function derivePreviewPassword(secret: string, slug: string): string {
  return hmac24(secret, `preview:${slug}`);
}

/**
 * The production fixture password, from its own secret and the message
 * `production:`. Pull-request code can read PREVIEW_SEED_SECRET, so production
 * must not derive from it.
 */
export function deriveProductionPassword(secret: string): string {
  return hmac24(secret, "production:");
}

function hmac24(secret: string, message: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("base64url").slice(0, 24);
}

const bad = (message: string): Either.Either<never, string> => Either.left(message);

function readSecret(
  env: Record<string, string | undefined>,
  name: "PREVIEW_SEED_SECRET" | "PRODUCTION_SEED_SECRET",
): Either.Either<string, string> {
  const secret = env[name] ?? "";
  return secret.length >= MIN_SECRET_LENGTH
    ? Either.right(secret)
    : bad(
        `${name} must be set to at least ${MIN_SECRET_LENGTH} characters. ` +
          "Preview and production seeds never use the password that is in this repo; " +
          "they derive one from that secret.",
      );
}

function readSlug(argv: string[], fallback: string): Either.Either<string, string> {
  const at = argv.indexOf("--pr");
  if (at < 0) return Either.right(fallback);
  const slug = argv[at + 1] ?? "";
  return SLUG.test(slug)
    ? Either.right(slug)
    : bad(`--pr needs a slug of letters, digits and dashes, got "${slug}"`);
}

function productionRefusal(): string {
  return [
    "Refusing to seed the top-level (production) D1 database.",
    "",
    "Seeding synthetic admin/user/banned fixtures into production is a",
    "footgun — it creates real, discoverable accounts with an admin role.",
    "",
    "If you genuinely need to seed production (e.g. bootstrapping a",
    "fresh prod DB, emergency demo data), re-run with the secret set:",
    "",
    "  PRODUCTION_SEED_SECRET=... bun scripts/seed-preview.ts --remote --force-production",
  ].join("\n");
}

/** Turn argv + env into a plan, or a message saying why not. Never exits. */
export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): Either.Either<Plan, string> {
  const has = (flag: string) => argv.includes(flag);

  if (has("--describe")) return Either.right({ kind: "describe" });

  if (has("--print-password")) {
    if (!has("--pr")) return bad("--print-password needs --pr <slug>");
    return Either.flatMap(readSecret(env, "PREVIEW_SEED_SECRET"), (secret) =>
      Either.map(
        readSlug(argv, "shared"),
        (slug): Plan => ({ kind: "print-password", password: derivePreviewPassword(secret, slug) }),
      ),
    );
  }

  if (has("--preview") && has("--remote"))
    return bad("Pass either --preview or --remote, not both.");

  if (has("--remote") && !has("--force-production")) return bad(productionRefusal());

  if (has("--remote")) {
    if (has("--pr")) return bad("--pr does not apply to the production seed");
    return Either.map(
      readSecret(env, "PRODUCTION_SEED_SECRET"),
      (secret): Plan => ({
        kind: "seed",
        target: { flags: ["--remote"], label: "production (--remote, forced)", local: false },
        password: deriveProductionPassword(secret),
      }),
    );
  }

  if (has("--preview")) {
    const target: Target = {
      flags: ["--env", "preview", "--remote"],
      label: "preview",
      local: false,
    };
    return Either.flatMap(readSecret(env, "PREVIEW_SEED_SECRET"), (secret) =>
      Either.map(
        readSlug(argv, "shared"),
        (slug): Plan => ({ kind: "seed", target, password: derivePreviewPassword(secret, slug) }),
      ),
    );
  }

  if (has("--pr")) return bad("--pr only applies with --preview or --remote --force-production");
  return Either.right({
    kind: "seed",
    target: { flags: ["--local"], label: "local", local: true },
    password: PASSWORD,
  });
}

/**
 * The seed SQL. Non-local targets also UPDATE each fixture's password, so a
 * rotated secret reaches live previews; local stays insert-only.
 */
export async function buildSql(
  password: string,
  target: Target,
  hash: (password: string) => Promise<string> = hashPassword,
  now: number = Date.now(),
): Promise<string> {
  const lines: string[] = [];

  for (const fixture of FIXTURES) {
    const passwordHash = await hash(password);
    const accountId = `${fixture.id}-account`;

    lines.push(
      `INSERT OR IGNORE INTO user (id, name, email, email_verified, role, banned, ban_reason) VALUES (` +
        [
          sqlString(fixture.id),
          sqlString(fixture.name),
          sqlString(fixture.email),
          fixture.emailVerified ? 1 : 0,
          sqlString(fixture.role),
          fixture.banned ? 1 : 0,
          fixture.banReason ? sqlString(fixture.banReason) : "NULL",
        ].join(", ") +
        `);`,
    );

    lines.push(
      `INSERT OR IGNORE INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (` +
        [
          sqlString(accountId),
          sqlString(fixture.id),
          sqlString("credential"),
          sqlString(fixture.id),
          sqlString(passwordHash),
          now,
          now,
        ].join(", ") +
        `);`,
    );

    if (!target.local) {
      lines.push(
        `UPDATE account SET password = ${sqlString(passwordHash)} WHERE id = ${sqlString(accountId)};`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function printCredentialsTable(target: Target): void {
  console.log(
    target.local
      ? `\nSeeded credentials (password for all: ${PASSWORD}):\n`
      : "\nSeeded accounts (password derived from a seed secret; see docs/ci/pipelines.md):\n",
  );
  const rows = FIXTURES.map((f) => ({
    email: f.email,
    role: f.role,
    note: f.banned ? "banned" : "",
  }));
  const emailWidth = Math.max(...rows.map((r) => r.email.length), "email".length);
  const roleWidth = Math.max(...rows.map((r) => r.role.length), "role".length);

  const header = `  ${"email".padEnd(emailWidth)}  ${"role".padEnd(roleWidth)}  note`;
  console.log(header);
  console.log(`  ${"-".repeat(emailWidth)}  ${"-".repeat(roleWidth)}  ----`);
  for (const row of rows) {
    console.log(`  ${row.email.padEnd(emailWidth)}  ${row.role.padEnd(roleWidth)}  ${row.note}`);
  }
  console.log("");
}

/**
 * Markdown summary of everything the seed creates — consumed by
 * .github/workflows/preview.yml to build the PR sticky comment, so the
 * comment always reflects the actual fixtures. Extend this alongside
 * FIXTURES (and any future seeded tables). It never prints a password.
 */
export function describeMarkdown(): string {
  const lines: string[] = [];
  lines.push("#### Seeded test accounts");
  lines.push("");
  lines.push(
    "The password is derived per preview from the `PREVIEW_SEED_SECRET` secret. " +
      "A maintainer prints it with " +
      "`PREVIEW_SEED_SECRET=... bun scripts/seed-preview.ts --print-password --pr <N>`.",
  );
  lines.push("");
  lines.push("| Email | Role | State |");
  lines.push("|-------|------|-------|");
  for (const f of FIXTURES) {
    const state = f.banned
      ? `banned (${f.banReason ?? "no reason"})`
      : f.emailVerified
        ? "active, email verified"
        : "active";
    lines.push(`| \`${f.email}\` | ${f.role} | ${state} |`);
  }
  lines.push("");
  lines.push(
    "Seeded data: the accounts above (Better Auth `user` + credential " +
      "`account` rows) — no other tables are seeded yet. Fixtures are " +
      "idempotent (`INSERT OR IGNORE`, fixed `seed-*` ids), so data you " +
      "create on the preview survives new pushes to this PR.",
  );
  return `${lines.join("\n")}\n`;
}

async function seed(target: Target, password: string): Promise<void> {
  const sql = await buildSql(password, target);

  // The SQL holds password hashes: a private directory, a private file.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-preview-"));
  const tmpFile = path.join(tmpDir, "seed.sql");
  fs.writeFileSync(tmpFile, sql, { mode: 0o600 });

  let failure: string | undefined;
  try {
    console.log(`Seeding ${target.label} D1 (DATABASE binding)...`);
    const command = [
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "DATABASE",
      ...target.flags,
      "--file",
      tmpFile,
    ].join(" ");

    execSync(command, { stdio: "inherit", env: process.env });

    console.log(`\x1b[32m✓ Seeded ${target.label} D1 with ${FIXTURES.length} fixture users\x1b[0m`);
    printCredentialsTable(target);
  } catch (error) {
    failure = (error as { message?: string } | null)?.message ?? String(error);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failure) {
    fail(`Failed to seed D1: ${failure}`);
  }
}

async function main(): Promise<void> {
  const plan = parseArgs(process.argv.slice(2), process.env);
  if (Either.isLeft(plan)) fail(plan.left);

  switch (plan.right.kind) {
    case "describe":
      process.stdout.write(describeMarkdown());
      return;
    case "print-password":
      process.stdout.write(`${plan.right.password}\n`);
      return;
    case "seed":
      await seed(plan.right.target, plan.right.password);
      return;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    fail(`Unexpected error: ${error?.message ?? String(error)}`);
  });
}
