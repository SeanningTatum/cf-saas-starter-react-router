#!/usr/bin/env bun
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { intro, outro, select, spinner, text, password, confirm, cancel, isCancel } from "@clack/prompts";
import { allResolved, parseSetupArgs, type SetupRequest } from "./lib/setup-args";
import { GENERATED_SECRET_LENGTH } from "./lib/setup-constants";
import type { Ask } from "./lib/setup-plan";
import { runCheck, runPass, type ReadinessDeps } from "./lib/setup-readiness-run";
import { childEnv, spawnRunner } from "./lib/setup-run";
import { isProvisioned, preserveVars, type WranglerConfig } from "./lib/setup-wrangler-vars";
import { buildWranglerConfig, readWranglerJsonc, REMOTE_MIGRATION_TARGETS, resourceNames, writeWranglerJsonc } from "./lib/wrangler-config";
import { run as runRepoRules } from "./repo-rules";

function sanitizeResourceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-") // Replace spaces with dashes
    .replace(/[^a-z0-9-]/g, ""); // Remove non-alphanumeric chars except dashes
}

function executeCommand(command: string, silent = false, env?: Record<string, string>) {
  if (!silent) {
    console.log(`\x1b[33m${command}\x1b[0m`);
  }
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: silent ? "pipe" : "inherit",
      env: childEnv(env),
    });
  } catch (error) {
    return { error: true, message: (error as { stdout?: string }).stdout || (error as { stderr?: string }).stderr || "" };
  }
}

async function prompt(message: string, defaultValue: string): Promise<string> {
  return (await text({
    message: `${message}:`,
    placeholder: defaultValue,
    defaultValue,
  })) as string;
}

function generateSecureRandomString(length: number): string {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

function updatePackageJsonName(projectName: string) {
  const packageJsonPath = path.join(__dirname, "..", "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    console.error(`\x1b[31mFile not found: ${packageJsonPath}\x1b[0m`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  pkg.name = projectName;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`\x1b[32m✓ Updated ${path.basename(packageJsonPath)}\x1b[0m`);
}

function removeWranglerFromGitignore() {
  const gitignorePath = path.join(__dirname, "..", ".gitignore");

  if (!fs.existsSync(gitignorePath)) {
    console.log("\x1b[33m⚠ .gitignore not found, skipping...\x1b[0m");
    return;
  }

  const content = fs.readFileSync(gitignorePath, "utf-8");
  const lines = content.split("\n");

  // Remove the line that contains only "wrangler.jsonc" (with optional whitespace)
  const filteredLines = lines.filter((line) => line.trim() !== "wrangler.jsonc");

  // Only write if something changed
  if (filteredLines.length !== lines.length) {
    fs.writeFileSync(gitignorePath, filteredLines.join("\n"));
    console.log("\x1b[32m✓ Removed wrangler.jsonc from .gitignore\x1b[0m");
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

async function promptForAccountId(accounts: { name: string; id: string }[]): Promise<string> {
  if (accounts.length === 1) {
    if (!accounts[0]?.id) {
      console.error("\x1b[31mNo accounts found. Please run `wrangler login`.\x1b[0m");
      cancel("Operation cancelled.");
      process.exit(1);
    }
    return accounts[0].id;
  } else if (accounts.length > 1) {
    const options = accounts.map((account) => ({
      value: account.id,
      label: account.name,
    }));
    const selectedAccountId = await select({
      message: "Select an account to use:",
      options,
    });

    return selectedAccountId as string;
  } else {
    console.error("\x1b[31mNo accounts found. Please run `wrangler login`.\x1b[0m");
    cancel("Operation cancelled.");
    process.exit(1);
  }
}

async function createDatabase(dbName: string, accountId?: string): Promise<string> {
  const dbSpinner = spinner();
  dbSpinner.start(`Creating D1 database: ${dbName}...`);

  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;
  const creationOutput = executeCommand(`bunx wrangler d1 create ${dbName}`, true, env);

  if (creationOutput === undefined || typeof creationOutput !== "string") {
    // Log the creation error for debugging
    if (creationOutput && typeof creationOutput === "object" && "message" in creationOutput) {
      console.log(`\x1b[33mCreate error: ${creationOutput.message}\x1b[0m`);
    }

    dbSpinner.stop(`\x1b[33m⚠ Database creation failed, maybe it already exists. Fetching info...\x1b[0m`);

    const dbInfoOutput = executeCommand(`bunx wrangler d1 info ${dbName}`, true, env);

    if (dbInfoOutput && typeof dbInfoOutput === "string") {
      const getInfo = dbInfoOutput.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (getInfo && getInfo.length >= 1) {
        const databaseID = getInfo[0];
        dbSpinner.stop(`\x1b[32m✓ Found database ID: ${databaseID}\x1b[0m`);
        return databaseID;
      }
    }

    // Log the info error for debugging
    if (dbInfoOutput && typeof dbInfoOutput === "object" && "message" in dbInfoOutput) {
      console.log(`\x1b[31mInfo error: ${dbInfoOutput.message}\x1b[0m`);
    }

    dbSpinner.stop(`\x1b[31m✗ Failed to create or find database\x1b[0m`);
    cancel("Operation cancelled.");
    process.exit(1);
  }

  // Extract database ID from the output (try both JSON and TOML formats)
  const jsonMatch = creationOutput.match(/"database_id":\s*"([^"]+)"/);
  const tomlMatch = creationOutput.match(/database_id\s*=\s*"([^"]+)"/);

  const databaseID = jsonMatch?.[1] || tomlMatch?.[1];
  if (databaseID) {
    dbSpinner.stop(`\x1b[32m✓ Database created with ID: ${databaseID}\x1b[0m`);
    return databaseID;
  }

  dbSpinner.stop(`\x1b[31m✗ Failed to extract database ID\x1b[0m`);
  console.log("\x1b[33mCommand output:\x1b[0m");
  console.log(creationOutput);
  cancel("Operation cancelled.");
  process.exit(1);
}

async function createBucket(bucketName: string, accountId?: string): Promise<void> {
  const bucketSpinner = spinner();
  bucketSpinner.start(`Creating R2 bucket: ${bucketName}...`);

  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;
  const result = executeCommand(`wrangler r2 bucket create ${bucketName}`, true, env);

  if (result && typeof result === "object" && result.error) {
    if (result.message.includes("already exists")) {
      bucketSpinner.stop(`\x1b[33m⚠ Bucket already exists\x1b[0m`);
    } else {
      bucketSpinner.stop(`\x1b[31m✗ Failed to create bucket\x1b[0m`);
      console.error(`\x1b[31m${result.message}\x1b[0m`);
    }
  } else {
    bucketSpinner.stop(`\x1b[32m✓ R2 bucket created\x1b[0m`);
  }
}

async function setupAuthentication(): Promise<{
  betterAuthSecret: string;
}> {
  console.log("\n\x1b[36m🔐 Setting up authentication...\x1b[0m");

  // Generate secure secret for Better Auth
  const betterAuthSecret = generateSecureRandomString(32);

  console.log("\x1b[32m✓ Generated BETTER_AUTH_SECRET\x1b[0m");

  return {
    betterAuthSecret,
  };
}

function createEnvFile(betterAuthSecret: string) {
  const envPath = path.join(__dirname, "..", ".env");

  if (fs.existsSync(envPath)) {
    console.log("\x1b[33m⚠ .env already exists, skipping...\x1b[0m");
    return;
  }

  const content = [
    `# Authentication secrets`,
    `BETTER_AUTH_SECRET=${betterAuthSecret}`,
    ``,
    `# Public variables`,
    `VITE_AUTH_URL=http://localhost:5173`,
    "",
  ].join("\n");

  fs.writeFileSync(envPath, content);
  console.log("\x1b[32m✓ Created .env file\x1b[0m");
}

async function runDatabaseMigrations(accountId?: string) {
  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;

  const localSpinner = spinner();
  localSpinner.start("Applying local migrations...");
  executeCommand(`bunx wrangler d1 migrations apply DATABASE --local`, true, env);
  localSpinner.stop("\x1b[32m✓ Local migrations applied\x1b[0m");

  for (const [label, flags] of REMOTE_MIGRATION_TARGETS) {
    const remoteSpinner = spinner();
    remoteSpinner.start(`Applying remote migrations (${label})...`);
    executeCommand(`bunx wrangler d1 migrations apply DATABASE${flags} --remote`, true, env);
    remoteSpinner.stop(`\x1b[32m✓ Remote migrations applied (${label})\x1b[0m`);
  }
}

// Updates (or adds) KEY=value in the text of a .env file.
export function upsertEnvLine(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (first >= 0) {
    // Keep the first line for the key, drop any repeats.
    return lines
      .map((l, i) => (i === first ? line : l))
      .filter((l, i) => i === first || !l.startsWith(`${key}=`))
      .join("\n");
  }
  return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`;
}

function updateLocalEnv(key: string, value: string) {
  const envPath = path.join(__dirname, "..", ".env");
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  // A new .env holds a secret: owner-only. An existing file keeps its mode.
  fs.writeFileSync(envPath, upsertEnvLine(current, key, value), { mode: 0o600 });
}

// Main setup function
function executeDeploy(label: string, script: string, accountId?: string) {
  const deploySpinner = spinner();
  deploySpinner.start(`Building and deploying (${label})...`);
  const result = executeCommand(`bun run ${script}`, true, accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined);
  if (result && typeof result === "object" && result.error) {
    deploySpinner.stop(`\x1b[31m✗ Deployment failed (${label})\x1b[0m`);
    console.error(`\x1b[31m${result.message}\x1b[0m`);
    console.log(`\x1b[33mYou can deploy manually later with: bun run ${script}\x1b[0m`);
    return;
  }
  deploySpinner.stop(`\x1b[32m✓ Deployed (${label}) 🎉\x1b[0m`);
}

function runStep(title: string, label: string, command: string, failure: string, accountId?: string) {
  console.log(`\n\x1b[36m${title}\x1b[0m`);
  const stepSpinner = spinner();
  stepSpinner.start(`${label}...`);
  const result = executeCommand(command, true, accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined);
  if (result && typeof result === "object" && result.error) {
    stepSpinner.stop(`\x1b[31m✗ ${label} failed\x1b[0m`);
    console.error(`\x1b[31m${result.message}\x1b[0m`);
    console.log(`\x1b[33m${failure}\x1b[0m`);
  } else {
    stepSpinner.stop(`\x1b[32m✓ ${label} done\x1b[0m`);
  }
}

async function chooseAccount(whoami: string, request: SetupRequest, interactive: boolean): Promise<string | undefined> {
  const accounts = extractAccountDetails(whoami);
  const given = request.values.get("account-id");
  if (given) return given;
  if (accounts.length <= 1) return accounts[0]?.id;
  if (!interactive) {
    console.error("\x1b[31m✗ Several Cloudflare accounts found: pass --account-id <id>.\x1b[0m");
    process.exit(1);
  }
  console.log(`\n\x1b[33m⚠ Multiple Cloudflare accounts detected (${accounts.length} accounts)\x1b[0m`);
  const chosen = await promptForAccountId(accounts);
  console.log(`\x1b[32m✓ Using account: ${chosen}\x1b[0m`);
  return chosen;
}

async function confirmOr(message: string, initialValue: boolean, interactive: boolean): Promise<boolean> {
  if (!interactive) return initialValue;
  const answer = await confirm({ message, initialValue });
  return typeof answer === "symbol" ? false : answer;
}

async function provision(request: SetupRequest, accountId: string | undefined, interactive: boolean): Promise<string> {
  console.log("\n\x1b[36m📝 Step 1: Project Configuration\x1b[0m");
  const defaultProjectName = sanitizeResourceName(path.basename(process.cwd()));
  const projectName = sanitizeResourceName(
    request.projectName ?? (interactive ? await prompt("Enter your project name", defaultProjectName) : defaultProjectName),
  );
  const enableR2 = request.r2 ?? (await confirmOr("Enable R2 file storage (uploads)?", true, interactive));
  const { dbName, previewDbName, stagingDbName, bucketName, previewBucketName, stagingBucketName } = resourceNames(projectName);

  console.log("\n\x1b[33mResource names:\x1b[0m");
  console.log(`  • Project: ${projectName}`);
  console.log(`  • Database: ${dbName}`);
  console.log(`  • Database (preview): ${previewDbName}`);
  console.log(`  • Database (staging): ${stagingDbName}`);
  if (enableR2) {
    console.log(`  • Bucket: ${bucketName}`);
    console.log(`  • Bucket (preview): ${previewBucketName}`);
    console.log(`  • Bucket (staging): ${stagingBucketName}`);
  } else {
    console.log(`  • R2 file storage: disabled`);
  }
  if (!(await confirmOr("Continue with these names?", true, interactive))) {
    cancel("Setup cancelled.");
    process.exit(0);
  }

  console.log("\n\x1b[36m☁️  Step 2: Creating Cloudflare Resources\x1b[0m");
  const dbId = await createDatabase(dbName, accountId);
  const previewDbId = await createDatabase(previewDbName, accountId);
  const stagingDbId = await createDatabase(stagingDbName, accountId);
  if (enableR2) {
    await createBucket(bucketName, accountId);
    await createBucket(previewBucketName, accountId);
    await createBucket(stagingBucketName, accountId);
  } else {
    console.log("\x1b[33m⚠ Skipping R2 bucket creation (disabled)\x1b[0m");
  }

  console.log("\n\x1b[36m🔐 Step 3: Authentication Setup\x1b[0m");
  const { betterAuthSecret } = await setupAuthentication();
  createEnvFile(betterAuthSecret);

  console.log("\n\x1b[36m📝 Step 4: Creating Configuration Files\x1b[0m");
  const fresh = buildWranglerConfig({ projectName, dbId, previewDbId, stagingDbId, enableR2 });
  writeWranglerJsonc(preserveVars(readWranglerJsonc(), fresh as WranglerConfig));
  console.log("\x1b[32m✓ Updated wrangler.jsonc (variables you set are kept)\x1b[0m");
  removeWranglerFromGitignore();
  updatePackageJsonName(projectName);

  runStep("📦 Step 5: Installing Dependencies", "Running bun install", "bun install", "Run bun install yourself.");
  runStep(
    "🔧 Step 6: Generating Cloudflare Types",
    "Running cf-typegen",
    "bun run cf-typegen",
    "You can generate types manually later with: bun run cf-typegen",
  );
  console.log("\n\x1b[36m🗄️  Step 7: Database Migrations\x1b[0m");
  await runDatabaseMigrations(accountId);
  console.log("\n\x1b[36m🚀 Step 8: Deploy to Cloudflare\x1b[0m");
  executeDeploy("production", "deploy", accountId);
  executeDeploy("preview", "deploy:preview", accountId);
  return projectName;
}

const clackAsk: Ask = {
  text: async (label) => {
    const answer = await text({ message: `${label}:` });
    return isCancel(answer) ? undefined : (answer as string);
  },
  secret: async (label) => {
    const answer = await password({ message: `${label} (input hidden):` });
    return isCancel(answer) ? undefined : (answer as string);
  },
  confirm: async (label, initial) => {
    const answer = await confirm({ message: label, initialValue: initial });
    return isCancel(answer) ? false : (answer as boolean);
  },
  say: (line) => console.log(`\x1b[33m${line}\x1b[0m`),
};

function buildDeps(ask: Ask | undefined, accountId: string | undefined): ReadinessDeps {
  return {
    run: spawnRunner,
    ask,
    readConfig: () => readWranglerJsonc(),
    writeConfig: (config) => writeWranglerJsonc(config),
    applyRules: runRepoRules,
    generateSecret: () => generateSecureRandomString(GENERATED_SECRET_LENGTH),
    saveLocalEnv: updateLocalEnv,
    accountId,
  };
}

function printLines(lines: ReadonlyArray<string>) {
  for (const line of lines) console.log(line);
}

async function main() {
  const request = parseSetupArgs({ argv: process.argv.slice(2), env: process.env, readStdin: () => fs.readFileSync(0, "utf-8") });
  if (request.errors.length > 0) {
    for (const error of request.errors) console.error(`\x1b[31m✗ ${error}\x1b[0m`);
    process.exit(2);
  }
  if (request.check) {
    const outcome = runCheck(buildDeps(undefined, undefined));
    printLines(outcome.lines);
    process.exit(outcome.code);
  }
  const interactive = Boolean(process.stdin.isTTY) && !request.yes && !allResolved(request);
  intro("🚀 Cloudflare SaaS Stack - First-Time Setup");

  console.log("\n\x1b[36mChecking Wrangler authentication...\x1b[0m");
  const whoamiOutput = executeCommand("wrangler whoami", true);
  if (!whoamiOutput || typeof whoamiOutput !== "string" || whoamiOutput.includes("not authenticated")) {
    console.error("\x1b[31m✗ Not logged in. Please run `wrangler login` first.\x1b[0m");
    cancel("Operation cancelled.");
    process.exit(1);
  }
  console.log("\x1b[32m✓ Authenticated with Cloudflare\x1b[0m");
  const accountId = await chooseAccount(whoamiOutput, request, interactive);

  const provisioning = request.provision || !isProvisioned(readWranglerJsonc());
  const projectName = provisioning ? await provision(request, accountId, interactive) : undefined;
  if (!provisioning)
    console.log(
      "\n\x1b[33mThis repo is already set up: only the readiness items you name or answer change. Add --provision to create the resources again.\x1b[0m",
    );

  console.log("\n\x1b[36m✅ Production readiness\x1b[0m");
  const outcome = await runPass(request, buildDeps(interactive ? clackAsk : undefined, accountId));
  printLines(outcome.lines);
  if (provisioning && outcome.varsChanged && outcome.code === 0) {
    executeDeploy("production", "deploy", accountId);
    executeDeploy("preview", "deploy:preview", accountId);
  }

  console.log("\n\x1b[36m✅ Setup Complete!\x1b[0m\n");
  if (projectName) {
    console.log("\x1b[32mNext steps:\x1b[0m");
    console.log("  1. For local development: \x1b[33mbun run dev\x1b[0m");
    console.log(`  2. Your production site: \x1b[33mhttps://${projectName}.<subdomain>.workers.dev\x1b[0m`);
    console.log("  3. CI/CD: docs/ci/pipelines.md. Check what is left any time with \x1b[33mbun run setup --check\x1b[0m");
  }
  outro("✨ Happy building! 🎉");
  process.exit(outcome.code);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("\x1b[31mUnexpected error:\x1b[0m", error);
    process.exit(1);
  });
}
