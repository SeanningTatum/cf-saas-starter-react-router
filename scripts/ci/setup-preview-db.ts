#!/usr/bin/env bun
// Per-PR preview D1 provisioning (CI-only, non-interactive).
//
// Usage: bun scripts/ci/setup-preview-db.ts <pr-number-or-slug>
//   e.g. `bun scripts/ci/setup-preview-db.ts 12` → database `<project>-db-pr-12`
//
// Creates (or finds) a dedicated D1 database for the PR, then patches the
// CI checkout's wrangler.jsonc so env.preview's DATABASE binding points at
// it. The patched wrangler.jsonc lives ONLY in the CI checkout — it is
// never committed. Subsequent steps (`wrangler d1 migrations apply --env
// preview`, `CLOUDFLARE_ENV=preview bun run build`, `wrangler versions
// upload`) all read the patched file, so the uploaded worker version
// carries per-PR bindings while the single preview worker serves all PRs.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stripJsonc } from "../lib/wrangler-config";

const WRANGLER_PATH = path.join(__dirname, "..", "..", "wrangler.jsonc");
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface WranglerConfig {
  name: string;
  env?: {
    preview?: {
      d1_databases?: {
        binding: string;
        database_name: string;
        database_id: string;
        migrations_dir?: string;
      }[];
    };
  };
  [key: string]: unknown;
}

function fail(message: string): never {
  console.error(`\x1b[31m✗ ${message}\x1b[0m`);
  process.exit(1);
}

function executeCommand(command: string): string | { error: true; message: string } {
  try {
    return execSync(command, { encoding: "utf-8", stdio: "pipe" });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { error: true, message: failure.stdout || failure.stderr || String(error) };
  }
}

function readWranglerConfig(): WranglerConfig {
  if (!fs.existsSync(WRANGLER_PATH)) {
    fail(`wrangler.jsonc not found at ${WRANGLER_PATH}`);
  }

  const content = fs.readFileSync(WRANGLER_PATH, "utf-8");
  // Strip single-line comments for JSONC parsing (same approach as teardown.ts)
  const jsonContent = stripJsonc(content);

  try {
    return JSON.parse(jsonContent);
  } catch {
    fail("Failed to parse wrangler.jsonc");
  }
}

function writeWranglerConfig(config: WranglerConfig): void {
  // Keep a generated-file header comment line, 2-space indent, trailing newline.
  const header =
    "// Patched by scripts/ci/setup-preview-db.ts — per-PR preview D1 (CI checkout only, never committed).";
  fs.writeFileSync(WRANGLER_PATH, `${header}\n${JSON.stringify(config, null, 2)}\n`);
}

function provisionDatabase(dbName: string): string {
  console.log(`Creating D1 database: ${dbName}...`);
  const createOutput = executeCommand(`bunx wrangler d1 create ${dbName}`);

  if (typeof createOutput === "string") {
    // Create outputs `"database_id": "..."` (JSON-ish) or TOML `database_id = "..."`
    const jsonMatch = createOutput.match(/"database_id":\s*"([^"]+)"/);
    const tomlMatch = createOutput.match(/database_id\s*=\s*"([^"]+)"/);
    const databaseId = jsonMatch?.[1] || tomlMatch?.[1] || createOutput.match(UUID_REGEX)?.[0];
    if (databaseId) {
      console.log(`Database created: ${dbName} (${databaseId})`);
      return databaseId;
    }
    fail(`Database created but could not extract database_id from output:\n${createOutput}`);
  }

  // Creation failed — likely already exists (PR synchronize after open). Look it up.
  console.log(`Create failed (may already exist), fetching info: ${dbName}...`);
  const infoOutput = executeCommand(`bunx wrangler d1 info ${dbName}`);

  if (typeof infoOutput === "string") {
    const databaseId = infoOutput.match(UUID_REGEX)?.[0];
    if (databaseId) {
      console.log(`Found existing database: ${dbName} (${databaseId})`);
      return databaseId;
    }
    fail(`Could not extract database_id from d1 info output:\n${infoOutput}`);
  }

  fail(
    `Failed to create or find database ${dbName}.\n` +
      `Create error: ${createOutput.message}\n` +
      `Info error: ${infoOutput.message}`,
  );
}

function main(): void {
  const slug = process.argv[2];
  if (!slug) {
    fail("Usage: bun scripts/ci/setup-preview-db.ts <pr-number-or-slug>");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    fail(`Invalid PR number/slug: "${slug}" (letters, digits, dashes only)`);
  }

  const config = readWranglerConfig();
  const dbName = `${config.name}-db-pr-${slug}`;

  const previewDb = config.env?.preview?.d1_databases?.find((db) => db.binding === "DATABASE");
  if (!previewDb) {
    fail('wrangler.jsonc has no env.preview d1_databases entry with binding "DATABASE" to patch');
  }

  const databaseId = provisionDatabase(dbName);

  previewDb.database_name = dbName;
  previewDb.database_id = databaseId;
  writeWranglerConfig(config);

  console.log(`Patched wrangler.jsonc: env.preview DATABASE → ${dbName} (${databaseId})`);
}

if (import.meta.main) {
  main();
}
