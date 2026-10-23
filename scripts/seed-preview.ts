#!/usr/bin/env bun
// Deterministic fixture seed for local D1 + per-PR preview databases.
//
// Usage:
//   bun scripts/seed-preview.ts              # local D1 (wrangler d1 execute DATABASE --local)
//   bun scripts/seed-preview.ts --preview     # preview-env D1 (--env preview --remote)
//   bun scripts/seed-preview.ts --remote --force-production
//                                             # top-level prod D1 (refuses without the flag)
//
// Seeds three Better Auth email/password fixtures (admin / user / banned),
// all sharing password `Password123!`. Fixture rows use fixed `seed-*` ids
// and `INSERT OR IGNORE`, so this is safe to rerun on every `bun run dev`
// invocation and on every PR synchronize in CI — it never overwrites rows a
// human or test has since modified.
//
// Rule: every feature adding a table or user-visible data extends these
// fixtures in the same diff.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

interface Target {
  /** Extra flags appended to `wrangler d1 execute DATABASE <flags> --file <tmp>`. */
  flags: string[];
  label: string;
}

function parseArgs(argv: string[]): Target {
  const hasPreview = argv.includes("--preview");
  const hasRemote = argv.includes("--remote");
  const hasForceProduction = argv.includes("--force-production");

  if (hasPreview && hasRemote) {
    fail("Pass either --preview or --remote, not both.");
  }

  if (hasRemote) {
    if (!hasForceProduction) {
      fail(
        [
          "Refusing to seed the top-level (production) D1 database.",
          "",
          "Seeding synthetic admin/user/banned fixtures into production is a",
          "footgun — it creates real, discoverable accounts (known password",
          `${PASSWORD}) with an admin role.`,
          "",
          "If you genuinely need to seed production (e.g. bootstrapping a",
          "fresh prod DB, emergency demo data), re-run with:",
          "",
          "  bun scripts/seed-preview.ts --remote --force-production",
        ].join("\n"),
      );
    }
    return { flags: ["--remote"], label: "production (--remote, forced)" };
  }

  if (hasPreview) {
    return { flags: ["--env", "preview", "--remote"], label: "preview" };
  }

  return { flags: ["--local"], label: "local" };
}

async function buildSql(): Promise<string> {
  const lines: string[] = [];
  const now = Date.now();

  for (const fixture of FIXTURES) {
    const passwordHash = await hashPassword(PASSWORD);

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
          sqlString(`${fixture.id}-account`),
          sqlString(fixture.id),
          sqlString("credential"),
          sqlString(fixture.id),
          sqlString(passwordHash),
          now,
          now,
        ].join(", ") +
        `);`,
    );
  }

  return lines.join("\n") + "\n";
}

function printCredentialsTable(): void {
  console.log("\nSeeded credentials (password for all: " + PASSWORD + "):\n");
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
 * FIXTURES (and any future seeded tables).
 */
function describeMarkdown(): string {
  const lines: string[] = [];
  lines.push("#### Seeded test accounts");
  lines.push("");
  lines.push(`Password for all accounts: \`${PASSWORD}\``);
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
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  if (process.argv.includes("--describe")) {
    process.stdout.write(describeMarkdown());
    return;
  }

  const target = parseArgs(process.argv.slice(2));
  const sql = await buildSql();

  const tmpFile = path.join(os.tmpdir(), `seed-preview-${Date.now()}.sql`);
  fs.writeFileSync(tmpFile, sql);

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
    printCredentialsTable();
  } catch (error: any) {
    failure = error?.message ?? String(error);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }

  if (failure) {
    fail(`Failed to seed D1: ${failure}`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    fail(`Unexpected error: ${error?.message ?? String(error)}`);
  });
}
