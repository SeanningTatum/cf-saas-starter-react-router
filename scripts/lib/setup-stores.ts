import {
  ACCOUNT_ID_VARIABLE,
  GH_ENVIRONMENT_ENDPOINT,
  NOT_DEPLOYED_MESSAGE,
  NOT_FOUND_PATTERN,
  WRANGLER_ENV_ARGS,
  type SetupEnvironment,
} from "./setup-constants";
import type { SetupItem } from "./setup-items";
import { failure, succeeded, wrangler, type Runner } from "./setup-run";

export interface StoreContext {
  readonly run: Runner;
  readonly accountId?: string;
}

const accountEnv = (context: StoreContext): Record<string, string> => (context.accountId ? { [ACCOUNT_ID_VARIABLE]: context.accountId } : {});

export const wranglerSecretArgs = (name: string, environment: SetupEnvironment, versions: boolean): string[] => [
  ...(versions ? ["versions"] : []),
  "secret",
  "put",
  name,
  ...WRANGLER_ENV_ARGS[environment],
];

const putWranglerSecret = (item: SetupItem, value: string, context: StoreContext): string | undefined => {
  const options = { input: value, env: accountEnv(context) };
  const [file, plain] = wrangler(wranglerSecretArgs(item.name, item.environment, false));
  const first = context.run(file, plain, options);
  if (succeeded(first)) return undefined;
  if (!first.stderr.includes(NOT_DEPLOYED_MESSAGE) && !first.stdout.includes(NOT_DEPLOYED_MESSAGE)) return failure(first, [value]);
  const [, versioned] = wrangler(wranglerSecretArgs(item.name, item.environment, true));
  const second = context.run(file, versioned, options);
  return succeeded(second) ? undefined : failure(second, [value]);
};

const ghSecretArgs = (item: SetupItem): string[] => ["secret", "set", item.name, ...(item.ghEnvironment ? ["--env", item.ghEnvironment] : [])];

export const ensureGhEnvironment = (name: string, context: StoreContext): string | undefined => {
  const endpoint = `${GH_ENVIRONMENT_ENDPOINT}/${name}`;
  const found = context.run("gh", ["api", endpoint]);
  if (succeeded(found)) return undefined;
  const reason = failure(found);
  if (!NOT_FOUND_PATTERN.test(reason)) return reason;
  const created = context.run("gh", ["api", "-X", "PUT", endpoint]);
  return succeeded(created) ? undefined : failure(created);
};

const putGhSecret = (item: SetupItem, value: string, context: StoreContext): string | undefined => {
  const prepared = item.ghEnvironment ? ensureGhEnvironment(item.ghEnvironment, context) : undefined;
  if (prepared !== undefined) return prepared;
  const result = context.run("gh", ghSecretArgs(item), { input: value });
  return succeeded(result) ? undefined : failure(result, [value]);
};

const putGhVariable = (item: SetupItem, value: string, context: StoreContext): string | undefined => {
  const result = context.run("gh", ["variable", "set", item.name, "--body", value]);
  return succeeded(result) ? undefined : failure(result);
};

export const putItem = (item: SetupItem, value: string, context: StoreContext): string | undefined => {
  if (item.store === "wrangler-secret") return putWranglerSecret(item, value, context);
  if (item.store === "gh-secret" || item.store === "gh-env-secret") return putGhSecret(item, value, context);
  if (item.store === "gh-variable") return putGhVariable(item, value, context);
  return undefined;
};

export const putNamedGhSecret = (name: string, value: string, context: StoreContext): string | undefined => {
  const result = context.run("gh", ["secret", "set", name], { input: value });
  return succeeded(result) ? undefined : failure(result, [value]);
};
