#!/usr/bin/env bun
import { execSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  intro,
  outro,
  select,
  spinner,
  text,
  password,
  confirm,
  cancel,
  isCancel,
} from "@clack/prompts";
import { buildWranglerConfig, writeWranglerJsonc } from "./lib/wrangler-config";

function sanitizeResourceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-") // Replace spaces with dashes
    .replace(/[^a-z0-9-]/g, ""); // Remove non-alphanumeric chars except dashes
}

function executeCommand(
  command: string,
  silent = false,
  env?: Record<string, string>
) {
  if (!silent) {
    console.log(`\x1b[33m${command}\x1b[0m`);
  }
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: silent ? "pipe" : "inherit",
      env: env ? { ...process.env, ...env } : undefined,
    });
  } catch (error: any) {
    return { error: true, message: error.stdout || error.stderr };
  }
}

// Like executeCommand, but takes an explicit executable + argv array and runs
// it WITHOUT a shell (spawnSync defaults to shell:false). Because each argument
// is passed as a discrete element, user-supplied values can never be
// interpreted by a shell — no command injection via `$(...)`, backticks, `;`,
// etc. Use this (never executeCommand) whenever any argument comes from user
// input. Returns the same shape as executeCommand: stdout string on success,
// or { error: true, message } on failure.
export function executeArgv(
  file: string,
  args: string[],
  silent = false,
  env?: Record<string, string>
) {
  if (!silent) {
    console.log(`\x1b[33m${file} ${args.join(" ")}\x1b[0m`);
  }
  const result = spawnSync(file, args, {
    encoding: "utf-8",
    stdio: silent ? "pipe" : "inherit",
    env: env ? { ...process.env, ...env } : undefined,
  });
  if (result.error || result.status !== 0) {
    return {
      error: true,
      message:
        result.stderr ||
        result.stdout ||
        result.error?.message ||
        `${file} exited with status ${result.status ?? "unknown"}`,
    };
  }
  return result.stdout ?? "";
}

// Builds the argv for setting the CLOUDFLARE_ACCOUNT_ID repo variable via `gh`.
// Kept as a pure function so the account ID is always carried as a single,
// discrete argv element (index 4) — passed to spawnSync without a shell it is
// treated as a literal string, so a crafted value like `foo"$(touch /tmp/pwned)"`
// can never execute in the developer's shell.
export function buildAccountIdVariableArgs(accountId: string): string[] {
  return ["variable", "set", "CLOUDFLARE_ACCOUNT_ID", "--body", accountId];
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
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`\x1b[32m✓ Updated ${path.basename(packageJsonPath)}\x1b[0m`);
}

function removeWranglerFromGitignore() {
  const gitignorePath = path.join(__dirname, "..", ".gitignore");

  if (!fs.existsSync(gitignorePath)) {
    console.log("\x1b[33m⚠ .gitignore not found, skipping...\x1b[0m");
    return;
  }

  let content = fs.readFileSync(gitignorePath, "utf-8");
  const lines = content.split("\n");

  // Remove the line that contains only "wrangler.jsonc" (with optional whitespace)
  const filteredLines = lines.filter(
    (line) => line.trim() !== "wrangler.jsonc"
  );

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
    const isValidLine =
      line.trim().startsWith("│ ") && line.trim().endsWith(" │");

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

async function promptForAccountId(
  accounts: { name: string; id: string }[]
): Promise<string> {
  if (accounts.length === 1) {
    if (!accounts[0]?.id) {
      console.error(
        "\x1b[31mNo accounts found. Please run `wrangler login`.\x1b[0m"
      );
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
    console.error(
      "\x1b[31mNo accounts found. Please run `wrangler login`.\x1b[0m"
    );
    cancel("Operation cancelled.");
    process.exit(1);
  }
}

async function createDatabase(
  dbName: string,
  accountId?: string
): Promise<string> {
  const dbSpinner = spinner();
  dbSpinner.start(`Creating D1 database: ${dbName}...`);

  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;
  const creationOutput = executeCommand(
    `bunx wrangler d1 create ${dbName}`,
    true,
    env
  );

  if (creationOutput === undefined || typeof creationOutput !== "string") {
    // Log the creation error for debugging
    if (
      creationOutput &&
      typeof creationOutput === "object" &&
      "message" in creationOutput
    ) {
      console.log(`\x1b[33mCreate error: ${creationOutput.message}\x1b[0m`);
    }

    dbSpinner.stop(
      `\x1b[33m⚠ Database creation failed, maybe it already exists. Fetching info...\x1b[0m`
    );

    const dbInfoOutput = executeCommand(
      `bunx wrangler d1 info ${dbName}`,
      true,
      env
    );

    if (dbInfoOutput && typeof dbInfoOutput === "string") {
      const getInfo = dbInfoOutput.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      );
      if (getInfo && getInfo.length >= 1) {
        const databaseID = getInfo[0];
        dbSpinner.stop(`\x1b[32m✓ Found database ID: ${databaseID}\x1b[0m`);
        return databaseID;
      }
    }

    // Log the info error for debugging
    if (
      dbInfoOutput &&
      typeof dbInfoOutput === "object" &&
      "message" in dbInfoOutput
    ) {
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

async function createBucket(
  bucketName: string,
  accountId?: string
): Promise<void> {
  const bucketSpinner = spinner();
  bucketSpinner.start(`Creating R2 bucket: ${bucketName}...`);

  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;
  const result = executeCommand(
    `wrangler r2 bucket create ${bucketName}`,
    true,
    env
  );

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

  const generateSpinner = spinner();
  generateSpinner.start("Generating migration...");
  executeCommand("bunx drizzle-kit generate --name setup", true);
  generateSpinner.stop("\x1b[32m✓ Migration generated\x1b[0m");

  const localSpinner = spinner();
  localSpinner.start("Applying local migrations...");
  executeCommand(
    `bunx wrangler d1 migrations apply DATABASE --local`,
    true,
    env
  );
  localSpinner.stop("\x1b[32m✓ Local migrations applied\x1b[0m");

  const remoteSpinner = spinner();
  remoteSpinner.start("Applying remote migrations (production)...");
  executeCommand(
    `bunx wrangler d1 migrations apply DATABASE --remote`,
    true,
    env
  );
  remoteSpinner.stop("\x1b[32m✓ Production migrations applied\x1b[0m");

  const previewSpinner = spinner();
  previewSpinner.start("Applying remote migrations (preview)...");
  executeCommand(
    `bunx wrangler d1 migrations apply DATABASE --env preview --remote`,
    true,
    env
  );
  previewSpinner.stop("\x1b[32m✓ Preview migrations applied\x1b[0m");
}

// Wires the two GitHub Actions credentials the CI/CD workflows need:
//   - repo VARIABLE CLOUDFLARE_ACCOUNT_ID (auto — we already know it)
//   - repo SECRET   CLOUDFLARE_API_TOKEN  (prompted, masked)
// Uses the GitHub CLI (`gh`). No-ops with guidance if gh is missing, not
// authenticated, or the repo has no GitHub remote — never blocks setup.
export async function setupGitHubCiCredentials(accountId?: string) {
  console.log("\n\x1b[36m🤖 Step 11: GitHub Actions CI/CD credentials\x1b[0m");

  const manualHint = () => {
    console.log(
      "\x1b[33mSkipped. To enable auto-deploy later, set these on GitHub\n" +
        "  (Settings → Secrets and variables → Actions):\n" +
        "    • Variable CLOUDFLARE_ACCOUNT_ID\n" +
        "    • Secret   CLOUDFLARE_API_TOKEN\x1b[0m"
    );
  };

  // gh installed?
  if (
    typeof executeCommand("gh --version", true) === "object" ||
    // gh authenticated? (`gh auth status` exits non-zero when logged out)
    typeof executeCommand("gh auth status", true) === "object" ||
    // repo has a GitHub remote gh can resolve?
    typeof executeCommand("gh repo view --json nameWithOwner", true) === "object"
  ) {
    console.log(
      "\x1b[33mGitHub CLI unavailable, not authenticated, or no GitHub remote detected.\x1b[0m"
    );
    manualHint();
    return;
  }

  const wire = await confirm({
    message:
      "Set CI/CD credentials on GitHub now (enables push-to-main → production deploy + PR previews)?",
    initialValue: true,
  });
  if (isCancel(wire) || !wire) {
    manualHint();
    return;
  }

  // 1. Account ID → repo variable (we already resolved it above; prompt if not).
  let resolvedAccountId = accountId;
  if (!resolvedAccountId) {
    const entered = await text({
      message: "Cloudflare account ID:",
    });
    if (isCancel(entered) || !entered) {
      manualHint();
      return;
    }
    resolvedAccountId = entered as string;
  }

  const varSpinner = spinner();
  varSpinner.start("Setting CLOUDFLARE_ACCOUNT_ID variable...");
  // Pass the account ID as a discrete argv entry via spawnSync (no shell) so a
  // crafted value can't inject commands into the developer's shell. See
  // buildAccountIdVariableArgs / executeArgv.
  const varResult = executeArgv(
    "gh",
    buildAccountIdVariableArgs(resolvedAccountId),
    true
  );
  if (varResult && typeof varResult === "object" && varResult.error) {
    varSpinner.stop("\x1b[31m✗ Failed to set CLOUDFLARE_ACCOUNT_ID\x1b[0m");
    console.error(`\x1b[31m${varResult.message}\x1b[0m`);
  } else {
    varSpinner.stop("\x1b[32m✓ CLOUDFLARE_ACCOUNT_ID variable set\x1b[0m");
  }

  // 2. API token → repo secret (sensitive → masked prompt).
  console.log(
    "\x1b[2mCreate a token at https://dash.cloudflare.com/profile/api-tokens\n" +
      "  from the 'Edit Cloudflare Workers' template, then add 'D1:Edit'\n" +
      "  (needed to run migrations in CI). Leave blank to skip.\x1b[0m"
  );
  const token = await password({
    message: "Cloudflare API token (input hidden):",
  });
  if (isCancel(token) || !token) {
    console.log(
      "\x1b[33mSkipped CLOUDFLARE_API_TOKEN. Set it later with:\n" +
        "  gh secret set CLOUDFLARE_API_TOKEN\x1b[0m"
    );
    return;
  }

  const secretSpinner = spinner();
  secretSpinner.start("Setting CLOUDFLARE_API_TOKEN secret...");
  // Pass the token via stdin (not argv) so it never lands in the process list.
  let secretError: string | undefined;
  try {
    execSync("gh secret set CLOUDFLARE_API_TOKEN", {
      input: token as string,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error: any) {
    secretError = error.stdout || error.stderr || String(error);
  }
  if (secretError) {
    secretSpinner.stop("\x1b[31m✗ Failed to set CLOUDFLARE_API_TOKEN\x1b[0m");
    console.error(`\x1b[31m${secretError}\x1b[0m`);
    console.log(
      "\x1b[33mSet it later with: gh secret set CLOUDFLARE_API_TOKEN\x1b[0m"
    );
  } else {
    secretSpinner.stop("\x1b[32m✓ CLOUDFLARE_API_TOKEN secret set\x1b[0m");
    console.log(
      "\x1b[32m🚀 CI/CD wired — pushes to main will now auto-deploy to production.\x1b[0m"
    );
  }
}

// Main setup function
async function main() {
  intro("🚀 Cloudflare SaaS Stack - First-Time Setup");

  // Check if wrangler is authenticated
  console.log("\n\x1b[36mChecking Wrangler authentication...\x1b[0m");
  const whoamiOutput = executeCommand("wrangler whoami", true);

  if (
    !whoamiOutput ||
    typeof whoamiOutput !== "string" ||
    whoamiOutput.includes("not authenticated")
  ) {
    console.error(
      "\x1b[31m✗ Not logged in. Please run `wrangler login` first.\x1b[0m"
    );
    cancel("Operation cancelled.");
    process.exit(1);
  }
  console.log("\x1b[32m✓ Authenticated with Cloudflare\x1b[0m");

  // Check for multiple accounts and prompt for selection if needed
  const accounts = extractAccountDetails(whoamiOutput);
  let accountId: string | undefined;

  if (accounts.length > 1) {
    console.log(
      `\n\x1b[33m⚠ Multiple Cloudflare accounts detected (${accounts.length} accounts)\x1b[0m`
    );
    accountId = await promptForAccountId(accounts);
    console.log(`\x1b[32m✓ Using account: ${accountId}\x1b[0m`);
  } else if (accounts.length === 1 && accounts[0]?.id) {
    accountId = accounts[0].id;
  }

  // Step 1: Get project name
  console.log("\n\x1b[36m📝 Step 1: Project Configuration\x1b[0m");
  const defaultProjectName = sanitizeResourceName(path.basename(process.cwd()));
  const projectName = sanitizeResourceName(
    await prompt("Enter your project name", defaultProjectName)
  );

  // Ask whether to provision R2 file storage. When disabled, no buckets are
  // created and the generated wrangler.jsonc omits the R2 bindings.
  const enableR2Answer = await confirm({
    message: "Enable R2 file storage (uploads)?",
    initialValue: true,
  });

  if (typeof enableR2Answer === "symbol") {
    cancel("Setup cancelled.");
    process.exit(0);
  }

  const enableR2 = enableR2Answer;

  // Generate resource names based on project name
  const dbName = `${projectName}-db`;
  const previewDbName = `${dbName}-preview`;
  const bucketName = `${projectName}-bucket`;
  const previewBucketName = `${bucketName}-preview`;

  console.log("\n\x1b[33mResource names:\x1b[0m");
  console.log(`  • Project: ${projectName}`);
  console.log(`  • Database: ${dbName}`);
  console.log(`  • Database (preview): ${previewDbName}`);
  if (enableR2) {
    console.log(`  • Bucket: ${bucketName}`);
    console.log(`  • Bucket (preview): ${previewBucketName}`);
  } else {
    console.log(`  • R2 file storage: disabled`);
  }

  const shouldContinue = await confirm({
    message: "Continue with these names?",
    initialValue: true,
  });

  if (!shouldContinue) {
    cancel("Setup cancelled.");
    process.exit(0);
  }

  // Step 2: Create Cloudflare resources
  console.log("\n\x1b[36m☁️  Step 2: Creating Cloudflare Resources\x1b[0m");

  let dbId: string;
  let previewDbId: string;
  try {
    dbId = await createDatabase(dbName, accountId);
    previewDbId = await createDatabase(previewDbName, accountId);
  } catch (error) {
    console.error("\x1b[31mError creating database:", error, "\x1b[0m");
    cancel("Operation cancelled.");
    process.exit(1);
  }

  if (enableR2) {
    await createBucket(bucketName, accountId);
    await createBucket(previewBucketName, accountId);
  } else {
    console.log("\x1b[33m⚠ Skipping R2 bucket creation (disabled)\x1b[0m");
  }

  // Step 3: Set up authentication
  console.log("\n\x1b[36m🔐 Step 3: Authentication Setup\x1b[0m");
  const { betterAuthSecret } = await setupAuthentication();

  createEnvFile(betterAuthSecret);

  // Step 4: Create configuration files
  console.log("\n\x1b[36m📝 Step 4: Creating Configuration Files\x1b[0m");

  // Overwrite the committed dummy wrangler.jsonc with real resource IDs
  const wranglerConfig = buildWranglerConfig({
    projectName,
    dbId,
    previewDbId,
    enableR2,
  });
  writeWranglerJsonc(wranglerConfig);
  console.log("\x1b[32m✓ Updated wrangler.jsonc\x1b[0m");

  // Remove wrangler.jsonc from .gitignore, if it's still listed there
  removeWranglerFromGitignore();

  // Update package.json's "name" field with the sanitized project name
  updatePackageJsonName(projectName);

  // Step 5: Install dependencies
  console.log("\n\x1b[36m📦 Step 5: Installing Dependencies\x1b[0m");
  const installSpinner = spinner();
  installSpinner.start("Running bun install...");
  const installResult = executeCommand("bun install", true);
  if (installResult && typeof installResult === "object" && installResult.error) {
    installSpinner.stop("\x1b[31m✗ Failed to install dependencies\x1b[0m");
    console.error(`\x1b[31m${installResult.message}\x1b[0m`);
  } else {
    installSpinner.stop("\x1b[32m✓ Dependencies installed\x1b[0m");
  }

  // Step 6: Generate Cloudflare types
  console.log("\n\x1b[36m🔧 Step 6: Generating Cloudflare Types\x1b[0m");
  const typegenSpinner = spinner();
  typegenSpinner.start("Running cf-typegen...");
  const typegenResult = executeCommand("bun run cf-typegen", true);
  if (typegenResult && typeof typegenResult === "object" && typegenResult.error) {
    typegenSpinner.stop("\x1b[31m✗ Failed to generate types\x1b[0m");
    console.error(`\x1b[31m${typegenResult.message}\x1b[0m`);
    console.log(
      "\x1b[33mYou can generate types manually later with: bun run cf-typegen\x1b[0m"
    );
  } else {
    typegenSpinner.stop("\x1b[32m✓ Cloudflare types generated\x1b[0m");
  }

  // Step 7: Run database migrations
  console.log("\n\x1b[36m🗄️  Step 7: Database Migrations\x1b[0m");
  await runDatabaseMigrations(accountId);

  // Step 8: Deploy to Cloudflare (production)
  console.log("\n\x1b[36m🚀 Step 8: Deploy to Cloudflare (production)\x1b[0m");
  const deploySpinner = spinner();
  deploySpinner.start("Building and deploying to Cloudflare Workers...");
  const deployResult = executeCommand(
    "bun run deploy",
    true,
    accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined
  );

  if (deployResult && typeof deployResult === "object" && deployResult.error) {
    deploySpinner.stop("\x1b[31m✗ Deployment failed\x1b[0m");
    console.error(`\x1b[31m${deployResult.message}\x1b[0m`);
    console.log(
      "\x1b[33mYou can deploy manually later with: bun run deploy\x1b[0m"
    );
  } else {
    deploySpinner.stop("\x1b[32m✓ Deployed successfully! 🎉\x1b[0m");
  }

  // Step 9: Deploy to Cloudflare (preview)
  console.log("\n\x1b[36m🚀 Step 9: Deploy to Cloudflare (preview)\x1b[0m");
  const deployPreviewSpinner = spinner();
  deployPreviewSpinner.start("Building and deploying the preview worker...");
  const deployPreviewResult = executeCommand(
    "bun run deploy:preview",
    true,
    accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined
  );

  if (
    deployPreviewResult &&
    typeof deployPreviewResult === "object" &&
    deployPreviewResult.error
  ) {
    deployPreviewSpinner.stop("\x1b[31m✗ Preview deployment failed\x1b[0m");
    console.error(`\x1b[31m${deployPreviewResult.message}\x1b[0m`);
    console.log(
      "\x1b[33mYou can deploy it manually later with: bun run deploy:preview\x1b[0m"
    );
  } else {
    deployPreviewSpinner.stop("\x1b[32m✓ Preview worker deployed! 🎉\x1b[0m");
  }

  // Step 10: Upload secrets
  // Secrets can only be uploaded to a worker that already exists — hence
  // this step runs after both workers have been deployed above.
  console.log("\n\x1b[36m🔑 Step 10: Uploading Secrets\x1b[0m");

  function uploadSecret(label: string, envFlag: string) {
    const secretSpinner = spinner();
    secretSpinner.start(`Uploading BETTER_AUTH_SECRET (${label})...`);
    const execEnv = accountId
      ? { CLOUDFLARE_ACCOUNT_ID: accountId }
      : undefined;

    let result = executeCommand(
      `echo "${betterAuthSecret}" | wrangler secret put BETTER_AUTH_SECRET${envFlag}`,
      true,
      execEnv
    );

    // `wrangler secret put` refuses when the worker's latest *uploaded*
    // version isn't the *deployed* one (happens once PR previews have run
    // `wrangler versions upload`). `versions secret put` handles that case:
    // it creates a new version with the secret, which subsequent version
    // uploads inherit.
    if (
      result &&
      typeof result === "object" &&
      result.error &&
      String(result.message).includes("isn't currently deployed")
    ) {
      secretSpinner.message(
        `Uploading BETTER_AUTH_SECRET (${label}) via versions secret put...`
      );
      result = executeCommand(
        `echo "${betterAuthSecret}" | wrangler versions secret put BETTER_AUTH_SECRET${envFlag}`,
        true,
        execEnv
      );
    }

    if (result && typeof result === "object" && result.error) {
      secretSpinner.stop(`\x1b[31m✗ Failed to upload secret (${label})\x1b[0m`);
      console.error(`\x1b[31m${result.message}\x1b[0m`);
      console.log(
        `\x1b[33mYou can upload it manually later with: wrangler secret put BETTER_AUTH_SECRET${envFlag}\x1b[0m`
      );
    } else {
      secretSpinner.stop(
        `\x1b[32m✓ BETTER_AUTH_SECRET uploaded (${label})\x1b[0m`
      );
    }
  }

  uploadSecret("production", "");
  uploadSecret("preview", " --env preview");

  // Step 11: Wire up GitHub Actions CI/CD credentials (optional).
  // Sets the repo VARIABLE CLOUDFLARE_ACCOUNT_ID and the repo SECRET
  // CLOUDFLARE_API_TOKEN that .github/workflows/{deploy,preview}.yml need to
  // deploy on push to main / per-PR. Entirely opt-in and skipped cleanly if
  // the GitHub CLI isn't available.
  await setupGitHubCiCredentials(accountId);

  // Final instructions
  console.log("\n\x1b[36m✅ Setup Complete!\x1b[0m\n");
  console.log("\x1b[32mNext steps:\x1b[0m");
  console.log("  1. For local development:");
  console.log("     \x1b[33mbun run dev\x1b[0m\n");
  console.log("  2. Your production site is live at:");
  console.log(
    `     \x1b[33mhttps://${projectName}.<subdomain>.workers.dev\x1b[0m\n`
  );
  console.log("  3. CI/CD (GitHub Actions):");
  console.log(
    "     \x1b[33m.github/workflows/deploy.yml\x1b[0m — push to main auto-deploys to production (after CI passes)"
  );
  console.log(
    "     \x1b[33m.github/workflows/preview.yml\x1b[0m — every PR gets its own preview deployment"
  );
  console.log(
    "     (both require the repo variable \x1b[33mCLOUDFLARE_ACCOUNT_ID\x1b[0m and the secret \x1b[33mCLOUDFLARE_API_TOKEN\x1b[0m on GitHub — Step 11 above sets these for you if the GitHub CLI is available)\n"
  );

  outro("✨ Happy building! 🎉");
}

// Only run the interactive setup when executed directly (e.g. `bun setup`),
// not when imported (e.g. by unit tests). Mirrors scripts/seed-preview.ts.
if (import.meta.main) {
  main().catch((error) => {
    console.error("\x1b[31mUnexpected error:\x1b[0m", error);
    process.exit(1);
  });
}
