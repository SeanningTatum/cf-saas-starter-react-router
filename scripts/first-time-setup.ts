#!/usr/bin/env bun
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  intro,
  outro,
  select,
  spinner,
  text,
  confirm,
  cancel,
} from "@clack/prompts";

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

function replaceHandlebarsInFile(
  filePath: string,
  replacements: Record<string, string>
) {
  if (!fs.existsSync(filePath)) {
    console.error(`\x1b[31mFile not found: ${filePath}\x1b[0m`);
    return;
  }

  let content = fs.readFileSync(filePath, "utf-8");

  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`{{${key}}}`, "g");
    content = content.replace(regex, value);
  }

  fs.writeFileSync(filePath, content);
  console.log(`\x1b[32m✓ Updated ${path.basename(filePath)}\x1b[0m`);
}

function createWranglerJson(
  projectName: string,
  dbName: string,
  dbId: string,
  bucketName: string
) {
  const wranglerJsonPath = path.join(__dirname, "..", "wrangler.jsonc");

  const wranglerConfig = {
    name: projectName,
    main: "workers/app.ts",
    compatibility_date: "2025-03-25",
    compatibility_flags: ["nodejs_compat"],
    assets: {
      directory: "build/client",
      binding: "ASSETS",
    },
    placement: {
      mode: "smart",
    },
    d1_databases: [
      {
        binding: "DATABASE",
        database_name: dbName,
        database_id: dbId,
        migrations_dir: "./drizzle",
      },
    ],
    r2_buckets: [
      {
        binding: "BUCKET",
        bucket_name: bucketName,
      },
    ],
    workflows: [
      {
        binding: "EXAMPLE_WORKFLOW",
        name: `${projectName}-example-workflow`,
        class_name: "ExampleWorkflow",
      },
    ],
    ai: {
      binding: "AI",
    },
    observability: {
      logs: {
        enabled: true,
        head_sampling_rate: 1,
        invocation_logs: true,
        persist: true,
      },
    },
  };

  const jsonContent =
    "// Secrets to be set via 'wrangler secret put BETTER_AUTH_SECRET'\n" +
    JSON.stringify(wranglerConfig, null, 2) +
    "\n";

  fs.writeFileSync(wranglerJsonPath, jsonContent);
  console.log("\x1b[32m✓ Created wrangler.jsonc\x1b[0m");
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

async function createKVNamespace(
  kvName: string,
  accountId?: string
): Promise<void> {
  const kvSpinner = spinner();
  kvSpinner.start(`Creating KV namespace: ${kvName}...`);

  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;
  const kvOutput = executeCommand(
    `wrangler kv namespace create ${kvName}`,
    true,
    env
  );

  if (kvOutput === undefined || typeof kvOutput !== "string") {
    kvSpinner.stop(`\x1b[33m⚠ KV namespace might already exist\x1b[0m`);
    return;
  }

  const matchResult = kvOutput.match(/id = "([^"]+)"/);
  if (matchResult && matchResult.length === 2) {
    kvSpinner.stop(`\x1b[32m✓ KV namespace created\x1b[0m`);
  } else {
    kvSpinner.stop(`\x1b[33m⚠ KV namespace creation status unknown\x1b[0m`);
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

async function runDatabaseMigrations(dbName: string, accountId?: string) {
  const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;

  const generateSpinner = spinner();
  generateSpinner.start("Generating migration...");
  executeCommand("bunx drizzle-kit generate --name setup", true);
  generateSpinner.stop("\x1b[32m✓ Migration generated\x1b[0m");

  const localSpinner = spinner();
  localSpinner.start("Applying local migrations...");
  executeCommand(
    `bunx wrangler d1 migrations apply "${dbName}" --local`,
    true,
    env
  );
  localSpinner.stop("\x1b[32m✓ Local migrations applied\x1b[0m");

  const remoteSpinner = spinner();
  remoteSpinner.start("Applying remote migrations...");
  executeCommand(
    `bunx wrangler d1 migrations apply "${dbName}" --remote`,
    true,
    env
  );
  remoteSpinner.stop("\x1b[32m✓ Remote migrations applied\x1b[0m");
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

  // Generate resource names based on project name
  const dbName = `${projectName}-db`;
  const bucketName = `${projectName}-bucket`;
  const kvName = `${projectName}-kv`;

  console.log("\n\x1b[33mResource names:\x1b[0m");
  console.log(`  • Project: ${projectName}`);
  console.log(`  • Database: ${dbName}`);
  console.log(`  • Bucket: ${bucketName}`);

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
  try {
    dbId = await createDatabase(dbName, accountId);
  } catch (error) {
    console.error("\x1b[31mError creating database:", error, "\x1b[0m");
    cancel("Operation cancelled.");
    process.exit(1);
  }

  await createBucket(bucketName, accountId);

  // Optionally create KV namespace
  const wantKV = await confirm({
    message: "Create KV namespace? (not required for basic setup)",
    initialValue: false,
  });

  if (wantKV) {
    await createKVNamespace(kvName, accountId);
  }

  // Step 3: Set up authentication
  console.log("\n\x1b[36m🔐 Step 3: Authentication Setup\x1b[0m");
  const { betterAuthSecret } = await setupAuthentication();

  createEnvFile(betterAuthSecret);

  // Step 4: Create configuration files
  console.log("\n\x1b[36m📝 Step 4: Creating Configuration Files\x1b[0m");

  // Create wrangler.jsonc from scratch
  createWranglerJson(projectName, dbName, dbId, bucketName);

  // Remove wrangler.jsonc from .gitignore since it's now configured
  removeWranglerFromGitignore();

  // Update package.json with database name
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const replacements = {
    projectName: sanitizeResourceName(projectName),
    dbName,
  };
  replaceHandlebarsInFile(packageJsonPath, replacements);

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
  await runDatabaseMigrations(dbName, accountId);

  // Step 8: Upload secrets
  console.log("\n\x1b[36m🔑 Step 8: Uploading Secrets\x1b[0m");
  const secretSpinner = spinner();
  secretSpinner.start("Uploading BETTER_AUTH_SECRET...");
  const secretResult = executeCommand(
    `echo "${betterAuthSecret}" | wrangler secret put BETTER_AUTH_SECRET`,
    true,
    accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined
  );
  if (secretResult && typeof secretResult === "object" && secretResult.error) {
    secretSpinner.stop("\x1b[31m✗ Failed to upload secret\x1b[0m");
    console.error(`\x1b[31m${secretResult.message}\x1b[0m`);
    console.log(
      "\x1b[33mYou can upload it manually later with: wrangler secret put BETTER_AUTH_SECRET\x1b[0m"
    );
  } else {
    secretSpinner.stop("\x1b[32m✓ BETTER_AUTH_SECRET uploaded\x1b[0m");
  }

  // Step 9: Deploy to Cloudflare
  console.log("\n\x1b[36m🚀 Step 9: Deploy to Cloudflare\x1b[0m");
  const deploySpinner = spinner();
  deploySpinner.start("Building and deploying to Cloudflare Workers...");
  const deployResult = executeCommand("bun run deploy", true, accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined);

  if (deployResult && typeof deployResult === "object" && deployResult.error) {
    deploySpinner.stop("\x1b[31m✗ Deployment failed\x1b[0m");
    console.error(`\x1b[31m${deployResult.message}\x1b[0m`);
    console.log(
      "\x1b[33mYou can deploy manually later with: bun run deploy\x1b[0m"
    );
  } else {
    deploySpinner.stop("\x1b[32m✓ Deployed successfully! 🎉\x1b[0m");
  }

  // Final instructions
  console.log("\n\x1b[36m✅ Setup Complete!\x1b[0m\n");
  console.log("\x1b[32mNext steps:\x1b[0m");
  console.log("  1. For local development:");
  console.log("     \x1b[33mbun run dev\x1b[0m\n");

  outro("✨ Happy building! 🎉");
}

main().catch((error) => {
  console.error("\x1b[31mUnexpected error:\x1b[0m", error);
  process.exit(1);
});
