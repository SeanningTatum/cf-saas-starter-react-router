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

function executeCommand(command: string, silent = false) {
  if (!silent) {
    console.log(`\x1b[33m${command}\x1b[0m`);
  }
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: silent ? "pipe" : "inherit",
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

function createWranglerToml(
  projectName: string,
  dbName: string,
  dbId: string,
  bucketName: string
) {
  const wranglerTomlPath = path.join(__dirname, "..", "wrangler.toml");

  const tomlContent = `# [secrets]
# BETTER_AUTH_SECRET

name = "${projectName}"
main = ".open-next/worker.js"
compatibility_date = "2025-03-25"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = ".open-next/assets"
binding = "ASSETS"

[placement]
mode = "smart"

[[d1_databases]]
binding = "DATABASE"
database_name = "${dbName}"
database_id = "${dbId}"
migrations_dir = "./drizzle"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "${bucketName}"

[ai]
binding = "AI"

[observability.logs]
enabled = true
head_sampling_rate = 1
invocation_logs = true
persist = true
`;

  fs.writeFileSync(wranglerTomlPath, tomlContent);
  console.log("\x1b[32m✓ Created wrangler.toml\x1b[0m");
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

async function createDatabase(dbName: string): Promise<string> {
  const dbSpinner = spinner();
  dbSpinner.start(`Creating D1 database: ${dbName}...`);

  const creationOutput = executeCommand(
    `bunx wrangler d1 create ${dbName}`,
    true
  );

  if (creationOutput === undefined || typeof creationOutput !== "string") {
    dbSpinner.stop(
      `\x1b[33m⚠ Database creation failed, maybe it already exists. Fetching info...\x1b[0m`
    );

    const dbInfoOutput = executeCommand(
      `bunx wrangler d1 info ${dbName}`,
      true
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

async function createBucket(bucketName: string): Promise<void> {
  const bucketSpinner = spinner();
  bucketSpinner.start(`Creating R2 bucket: ${bucketName}...`);

  const result = executeCommand(
    `wrangler r2 bucket create ${bucketName}`,
    true
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

async function createKVNamespace(kvName: string): Promise<void> {
  const kvSpinner = spinner();
  kvSpinner.start(`Creating KV namespace: ${kvName}...`);

  const kvOutput = executeCommand(
    `wrangler kv namespace create ${kvName}`,
    true
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

async function runDatabaseMigrations(dbName: string) {
  console.log("\n\x1b[36m📦 Running database migrations...\x1b[0m");

  const generateSpinner = spinner();
  generateSpinner.start("Generating migration...");
  executeCommand("bunx drizzle-kit generate --name setup", true);
  generateSpinner.stop("\x1b[32m✓ Migration generated\x1b[0m");

  const localSpinner = spinner();
  localSpinner.start("Applying local migrations...");
  executeCommand(`bunx wrangler d1 migrations apply "${dbName}" --local`, true);
  localSpinner.stop("\x1b[32m✓ Local migrations applied\x1b[0m");

  const remoteSpinner = spinner();
  remoteSpinner.start("Applying remote migrations...");
  executeCommand(
    `bunx wrangler d1 migrations apply "${dbName}" --remote`,
    true
  );
  remoteSpinner.stop("\x1b[32m✓ Remote migrations applied\x1b[0m");
}

async function uploadSecret(secretName: string, secretValue: string) {
  if (!secretValue || secretValue === "") {
    console.log(`\x1b[33m⚠ Skipping ${secretName} (empty value)\x1b[0m`);
    return;
  }

  const secretSpinner = spinner();
  secretSpinner.start(`Uploading ${secretName}...`);

  try {
    const tempFile = path.join(__dirname, "..", `.temp-${secretName}`);
    fs.writeFileSync(tempFile, secretValue);

    try {
      const command =
        process.platform === "win32"
          ? `type "${tempFile}" | wrangler secret put ${secretName}`
          : `cat "${tempFile}" | wrangler secret put ${secretName}`;

      const result = executeCommand(command, true);

      if (result && typeof result === "object" && result.error) {
        secretSpinner.stop(`\x1b[31m✗ Failed to upload ${secretName}\x1b[0m`);
      } else {
        secretSpinner.stop(`\x1b[32m✓ ${secretName} uploaded\x1b[0m`);
      }
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  } catch (error) {
    secretSpinner.stop(`\x1b[31m✗ Failed to upload ${secretName}\x1b[0m`);
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
    dbId = await createDatabase(dbName);
  } catch (error) {
    console.error("\x1b[31mError creating database:", error, "\x1b[0m");
    const accountIds = extractAccountDetails(whoamiOutput);
    const accountId = await promptForAccountId(accountIds);
    console.log(
      `\x1b[33mPlease set: export CLOUDFLARE_ACCOUNT_ID=${accountId}\x1b[0m`
    );
    console.log("\x1b[33mThen run this setup script again.\x1b[0m");
    cancel("Operation cancelled.");
    process.exit(1);
  }

  await createBucket(bucketName);

  // Optionally create KV namespace
  const wantKV = await confirm({
    message: "Create KV namespace? (not required for basic setup)",
    initialValue: false,
  });

  if (wantKV) {
    await createKVNamespace(kvName);
  }

  // Step 3: Set up authentication
  console.log("\n\x1b[36m🔐 Step 3: Authentication Setup\x1b[0m");
  const { betterAuthSecret } = await setupAuthentication();

  createEnvFile(betterAuthSecret);

  // Step 4: Create configuration files
  console.log("\n\x1b[36m📝 Step 4: Creating Configuration Files\x1b[0m");

  // Create wrangler.toml from scratch
  createWranglerToml(projectName, dbName, dbId, bucketName);

  // Update package.json with database name
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const replacements = {
    projectName: sanitizeResourceName(projectName),
    dbName,
  };
  replaceHandlebarsInFile(packageJsonPath, replacements);

  // Step 5: Run database migrations
  await runDatabaseMigrations(dbName);

  // Step 6: Optionally deploy secrets
  console.log("\n\x1b[36m🚀 Step 5: Deploy to Production (Optional)\x1b[0m");
  const shouldDeploySecrets = await confirm({
    message: "Deploy secrets to Cloudflare Workers now?",
    initialValue: false,
  });

  let secretsDeployed = false;
  if (shouldDeploySecrets) {
    console.log("\n\x1b[36mDeploying secrets...\x1b[0m");
    await uploadSecret("BETTER_AUTH_SECRET", betterAuthSecret);
    secretsDeployed = true;
  } else {
    console.log(
      "\x1b[33m⚠ Skipped secret deployment. Run 'wrangler secret put' later to manage secrets.\x1b[0m"
    );
  }

  // Step 7: Optionally build and deploy the worker
  if (secretsDeployed) {
    console.log(
      "\n\x1b[36m🚀 Step 6: Build and Deploy Worker (Optional)\x1b[0m"
    );

    const shouldDeploy = await confirm({
      message: "Build and deploy the worker to Cloudflare now?",
      initialValue: false,
    });

    if (shouldDeploy) {
      // Build the application
      const buildSpinner = spinner();
      buildSpinner.start("Building application...");
      const buildResult = executeCommand("bun run build:cloudflare", true);

      if (buildResult && typeof buildResult === "object" && buildResult.error) {
        buildSpinner.stop("\x1b[31m✗ Build failed\x1b[0m");
        console.error(`\x1b[31m${buildResult.message}\x1b[0m`);
        console.log(
          "\x1b[33mYou can build and deploy manually later with: bun run deploy\x1b[0m"
        );
      } else {
        buildSpinner.stop("\x1b[32m✓ Build completed\x1b[0m");

        // Deploy to Cloudflare
        const deploySpinner = spinner();
        deploySpinner.start("Deploying to Cloudflare Workers...");
        const deployResult = executeCommand("bun run deploy", true);

        if (
          deployResult &&
          typeof deployResult === "object" &&
          deployResult.error
        ) {
          deploySpinner.stop("\x1b[31m✗ Deployment failed\x1b[0m");
          console.error(`\x1b[31m${deployResult.message}\x1b[0m`);
        } else {
          deploySpinner.stop("\x1b[32m✓ Deployed successfully! 🎉\x1b[0m");
          console.log(
            "\n\x1b[36mYour application is now live on Cloudflare!\x1b[0m"
          );
        }
      }
    } else {
      console.log(
        "\x1b[33m⚠ Skipped deployment. You can deploy later with: bun run deploy\x1b[0m"
      );
    }
  }

  // Final instructions
  console.log("\n\x1b[36m✅ Setup Complete!\x1b[0m\n");
  console.log("\x1b[32mNext steps:\x1b[0m");

  if (!secretsDeployed) {
    console.log("  1. For local development:");
    console.log("     \x1b[33mbun run dev\x1b[0m\n");
    console.log("  2. Before deploying to production:");
    console.log(
      "     • Deploy secrets: \x1b[33mwrangler secret put BETTER_AUTH_SECRET\x1b[0m"
    );
    console.log("     • Run: \x1b[33mbun run deploy\x1b[0m\n");
  } else {
    console.log("  1. For local development:");
    console.log("     \x1b[33mbun run dev\x1b[0m\n");
    console.log("  2. Configure your production domain:");
    console.log("     • Configure R2 CORS policy for your domain\n");
  }

  outro("✨ Happy building! 🎉");
}

main().catch((error) => {
  console.error("\x1b[31mUnexpected error:\x1b[0m", error);
  process.exit(1);
});
