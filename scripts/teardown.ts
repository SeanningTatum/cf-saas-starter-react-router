#!/usr/bin/env bun
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { intro, outro, confirm, spinner, cancel } from "@clack/prompts";
import { DUMMY_INPUT, buildWranglerConfig, parseJsonc, writeWranglerJsonc } from "./lib/wrangler-config";

function executeCommand(command: string, silent = false, env?: Record<string, string>) {
  if (!silent) {
    console.log(`\x1b[33m${command}\x1b[0m`);
  }
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: silent ? "pipe" : "inherit",
      env: env ? { ...process.env, ...env } : undefined,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { error: true, message: failure.stdout || failure.stderr || "" };
  }
}

function extractAccountDetails(output: string): { name: string; id: string }[] {
  const lines = output.split("\n");
  const accountDetails: { name: string; id: string }[] = [];

  for (const line of lines) {
    const isValidLine = line.trim().startsWith("│ ") && line.trim().endsWith(" │");

    if (isValidLine) {
      const regex = /\b[a-f0-9]{32}\b/g;
      const matches = line.match(regex);

      if (matches && matches.length === 1) {
        const accountName = line.split("│ ")[1]?.trim();
        const accountId = matches[0].replace("│ ", "").replace(" │", "");
        if (accountName && accountId) {
          accountDetails.push({ name: accountName, id: accountId });
        }
      }
    }
  }

  return accountDetails;
}

function restorePackageJsonName() {
  const packageJsonPath = path.join(__dirname, "..", "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    console.error("\x1b[31m✗ package.json not found\x1b[0m");
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  pkg.name = "cf-saas-starter-react-router";
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log("\x1b[32m✓ Restored package.json name\x1b[0m");
}

interface WranglerEnvConfig {
  d1_databases?: { binding: string; database_name: string; database_id: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  kv_namespaces?: { binding: string; id: string }[];
}

interface WranglerConfig extends WranglerEnvConfig {
  name: string;
  env?: {
    preview?: WranglerEnvConfig;
  };
}

function readWranglerConfig(): WranglerConfig | null {
  const wranglerPath = path.join(__dirname, "..", "wrangler.jsonc");

  if (!fs.existsSync(wranglerPath)) {
    return null;
  }

  const config = parseJsonc<WranglerConfig>(fs.readFileSync(wranglerPath, "utf-8"));
  if (!config) console.error("\x1b[31m✗ Failed to parse wrangler.jsonc\x1b[0m");
  return config;
}

/**
 * Lists orphaned per-PR preview databases (`<project>-db-pr-<N>`, created by
 * CI via scripts/ci/setup-preview-db.ts). Returns null if the list fails
 * (e.g. not authenticated yet) — callers should warn + skip in that case.
 */
function listPerPrDatabases(projectName: string, env?: Record<string, string>): string[] | null {
  const result = executeCommand("bunx wrangler d1 list --json", true, env);
  if (!result || typeof result !== "string") {
    return null;
  }

  // Tolerate any leading non-JSON output from wrangler.
  const jsonStart = result.indexOf("[");
  if (jsonStart === -1) {
    return null;
  }

  try {
    const dbs = JSON.parse(result.slice(jsonStart)) as {
      name: string;
      uuid: string;
    }[];
    const prefix = `${projectName}-db-pr-`;
    return dbs.map((db) => db.name).filter((name) => name.startsWith(prefix));
  } catch {
    return null;
  }
}

async function main() {
  intro("🗑️  Cloudflare SaaS Stack - Teardown");

  // Read wrangler.jsonc to get resource names
  const config = readWranglerConfig();

  if (!config) {
    console.error("\x1b[31m✗ wrangler.jsonc not found. Nothing to tear down.\x1b[0m");
    cancel("Operation cancelled.");
    process.exit(1);
  }

  const projectName = config.name;
  const previewWorkerName = `${projectName}-preview`;

  // Collect top-level + preview-env resources, deduped by name/id.
  const databases = [...(config.d1_databases ?? []), ...(config.env?.preview?.d1_databases ?? [])].filter(
    (db, index, arr) => arr.findIndex((d) => d.database_name === db.database_name) === index,
  );

  const buckets = [...(config.r2_buckets ?? []), ...(config.env?.preview?.r2_buckets ?? [])].filter(
    (bucket, index, arr) => arr.findIndex((b) => b.bucket_name === bucket.bucket_name) === index,
  );

  const kvNamespaces = [...(config.kv_namespaces ?? []), ...(config.env?.preview?.kv_namespaces ?? [])].filter(
    (kv, index, arr) => arr.findIndex((k) => k.id === kv.id) === index,
  );

  // Sweep for orphaned per-PR preview databases BEFORE the confirm prompt,
  // so the summary below is accurate.
  const perPrDatabases = listPerPrDatabases(projectName);

  console.log("\n\x1b[31mThe following resources will be DELETED:\x1b[0m\n");
  console.log(`  • Worker:   ${projectName}`);
  console.log(`  • Worker:   ${previewWorkerName}`);
  for (const db of databases) {
    console.log(`  • D1 DB:    ${db.database_name} (${db.database_id})`);
  }
  for (const bucket of buckets) {
    console.log(`  • R2:       ${bucket.bucket_name}`);
  }
  for (const kv of kvNamespaces) {
    console.log(`  • KV:       ${kv.id}`);
  }
  if (perPrDatabases === null) {
    console.log(`  \x1b[33m⚠ Could not list per-PR preview databases (wrangler d1 list failed) — sweep will be skipped\x1b[0m`);
  } else {
    console.log(`  • plus any per-PR preview databases (${perPrDatabases.length} found)`);
    for (const name of perPrDatabases) {
      console.log(`      - ${name}`);
    }
  }

  const shouldContinue = await confirm({
    message: "Are you sure you want to delete ALL of these resources? This cannot be undone.",
    initialValue: false,
  });

  if (!shouldContinue) {
    cancel("Teardown cancelled.");
    process.exit(0);
  }

  // Check wrangler auth
  console.log("\n\x1b[36mChecking Wrangler authentication...\x1b[0m");
  const whoamiOutput = executeCommand("wrangler whoami", true);

  if (!whoamiOutput || typeof whoamiOutput !== "string" || whoamiOutput.includes("not authenticated")) {
    console.error("\x1b[31m✗ Not logged in. Please run `wrangler login` first.\x1b[0m");
    cancel("Operation cancelled.");
    process.exit(1);
  }
  console.log("\x1b[32m✓ Authenticated with Cloudflare\x1b[0m");

  // Detect account
  const accounts = extractAccountDetails(whoamiOutput);
  let accountId: string | undefined;

  if (accounts.length > 1) {
    // Import select dynamically since we only need it for multi-account
    const { select } = await import("@clack/prompts");
    console.log(`\n\x1b[33m⚠ Multiple Cloudflare accounts detected (${accounts.length} accounts)\x1b[0m`);
    const options = accounts.map((account) => ({
      value: account.id,
      label: account.name,
    }));
    accountId = (await select({
      message: "Select the account to tear down from:",
      options,
    })) as string;
  } else if (accounts.length === 1 && accounts[0]?.id) {
    accountId = accounts[0].id;
  }

  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;

  // Step 1: Delete the Workers (production + preview)
  console.log("\n\x1b[36m🗑️  Step 1: Deleting Workers\x1b[0m");
  for (const workerName of [projectName, previewWorkerName]) {
    const workerSpinner = spinner();
    workerSpinner.start(`Deleting worker: ${workerName}...`);
    const workerResult = executeCommand(`wrangler delete --name ${workerName} --force`, true, env);
    if (workerResult && typeof workerResult === "object" && workerResult.error) {
      workerSpinner.stop(`\x1b[33m⚠ Worker deletion failed (may not exist): ${workerName}\x1b[0m`);
    } else {
      workerSpinner.stop(`\x1b[32m✓ Worker deleted: ${workerName}\x1b[0m`);
    }
  }

  // Step 2: Delete D1 databases
  console.log("\n\x1b[36m🗑️  Step 2: Deleting D1 Databases\x1b[0m");
  for (const db of databases) {
    const dbSpinner = spinner();
    dbSpinner.start(`Deleting database: ${db.database_name}...`);
    const dbResult = executeCommand(`wrangler d1 delete ${db.database_name} -y`, true, env);
    if (dbResult && typeof dbResult === "object" && dbResult.error) {
      // Try by ID if name fails
      const dbResult2 = executeCommand(`wrangler d1 delete ${db.database_id} -y`, true, env);
      if (dbResult2 && typeof dbResult2 === "object" && dbResult2.error) {
        dbSpinner.stop(`\x1b[33m⚠ Failed to delete database: ${db.database_name}\x1b[0m`);
      } else {
        dbSpinner.stop(`\x1b[32m✓ Database deleted: ${db.database_name}\x1b[0m`);
      }
    } else {
      dbSpinner.stop(`\x1b[32m✓ Database deleted: ${db.database_name}\x1b[0m`);
    }
  }

  // Orphan sweep: per-PR preview databases created by CI
  // (scripts/ci/setup-preview-db.ts) that never appear in wrangler.jsonc.
  // Re-list now that the account is resolved — the pre-confirm listing ran
  // without an account id and may have failed (or hit the wrong account) in
  // multi-account setups.
  const sweepDatabases = listPerPrDatabases(projectName, env) ?? perPrDatabases;
  if (sweepDatabases === null) {
    console.log("\x1b[33m⚠ Skipping per-PR preview database sweep (wrangler d1 list failed)\x1b[0m");
  } else {
    const alreadyDeleted = new Set(databases.map((db) => db.database_name));
    for (const name of sweepDatabases) {
      if (alreadyDeleted.has(name)) continue;
      const prDbSpinner = spinner();
      prDbSpinner.start(`Deleting per-PR database: ${name}...`);
      const prDbResult = executeCommand(`wrangler d1 delete ${name} -y`, true, env);
      if (prDbResult && typeof prDbResult === "object" && prDbResult.error) {
        prDbSpinner.stop(`\x1b[33m⚠ Failed to delete per-PR database: ${name}\x1b[0m`);
      } else {
        prDbSpinner.stop(`\x1b[32m✓ Per-PR database deleted: ${name}\x1b[0m`);
      }
    }
  }

  // Step 3: Delete R2 buckets
  console.log("\n\x1b[36m🗑️  Step 3: Deleting R2 Buckets\x1b[0m");
  for (const bucket of buckets) {
    const bucketSpinner = spinner();
    bucketSpinner.start(`Deleting bucket: ${bucket.bucket_name}...`);
    const bucketResult = executeCommand(`wrangler r2 bucket delete ${bucket.bucket_name}`, true, env);
    if (bucketResult && typeof bucketResult === "object" && bucketResult.error) {
      bucketSpinner.stop(`\x1b[33m⚠ Failed to delete bucket: ${bucket.bucket_name}\x1b[0m`);
    } else {
      bucketSpinner.stop(`\x1b[32m✓ Bucket deleted: ${bucket.bucket_name}\x1b[0m`);
    }
  }

  // Step 4: Delete KV namespaces
  if (kvNamespaces.length > 0) {
    console.log("\n\x1b[36m🗑️  Step 4: Deleting KV Namespaces\x1b[0m");
    for (const kv of kvNamespaces) {
      const kvSpinner = spinner();
      kvSpinner.start(`Deleting KV namespace: ${kv.id}...`);
      const kvResult = executeCommand(`wrangler kv namespace delete --namespace-id ${kv.id}`, true, env);
      if (kvResult && typeof kvResult === "object" && kvResult.error) {
        kvSpinner.stop(`\x1b[33m⚠ Failed to delete KV namespace: ${kv.id}\x1b[0m`);
      } else {
        kvSpinner.stop(`\x1b[32m✓ KV namespace deleted\x1b[0m`);
      }
    }
  }

  // Step 5: Restore package.json
  console.log("\n\x1b[36m🔄 Step 5: Restoring package.json\x1b[0m");
  restorePackageJsonName();

  // Step 6: Clean up local files
  console.log("\n\x1b[36m🧹 Step 6: Cleaning Up Local Files\x1b[0m");

  // Restore wrangler.jsonc to the committed dummy version
  writeWranglerJsonc(buildWranglerConfig(DUMMY_INPUT));
  console.log("\x1b[32m✓ Restored wrangler.jsonc to dummy values\x1b[0m");

  const cleanupEnv = await confirm({
    message: "Delete local .env file?",
    initialValue: false,
  });

  if (cleanupEnv) {
    const envPath = path.join(__dirname, "..", ".env");

    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
      console.log("\x1b[32m✓ Deleted .env\x1b[0m");
    }
  }

  console.log("\n\x1b[36m✅ Teardown Complete!\x1b[0m\n");
  console.log("\x1b[32mAll Cloudflare resources have been deleted.\x1b[0m");
  console.log("\x1b[33mTo set up again, run: bun run setup\x1b[0m\n");

  outro("🏁 Done!");
}

main().catch((error) => {
  console.error("\x1b[31mUnexpected error:\x1b[0m", error);
  process.exit(1);
});
