import {
  GH_PRODUCTION_ENVIRONMENT,
  GH_STAGING_ENVIRONMENT,
  SETUP_COMMAND,
  SETUP_ENVIRONMENTS,
  STDIN_MARK,
  WRANGLER_ENV_ARGS,
  type SetupEnvironment,
} from "./setup-constants";
import { envVarOf, flagOf, itemById, SETUP_ITEMS, type SetupItem } from "./setup-items";
import { succeeded, wrangler, type Runner } from "./setup-run";
import { varNames, type WranglerConfig } from "./setup-wrangler-vars";

export type Status = "set" | "missing" | "skipped" | "unread";

export interface Snapshot {
  readonly wranglerVars: Readonly<Record<SetupEnvironment, ReadonlySet<string>>>;
  readonly wranglerSecrets: Readonly<Record<SetupEnvironment, ReadonlySet<string> | undefined>>;
  readonly ghSecrets: ReadonlySet<string> | undefined;
  readonly ghEnvSecrets: Readonly<Record<string, ReadonlySet<string> | undefined>>;
  readonly ghVariables: ReadonlySet<string> | undefined;
}

export interface Row {
  readonly item: SetupItem;
  readonly status: Status;
  readonly command: string;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const namesFromJson = (text: string): ReadonlySet<string> | undefined => {
  if (!text.trim().startsWith("[")) return undefined;
  const parsed = parseJson(text);
  if (!Array.isArray(parsed)) return undefined;
  const names = parsed.flatMap((entry) =>
    typeof entry === "object" && entry !== null && "name" in entry && typeof entry.name === "string" ? [entry.name] : [],
  );
  return new Set(names);
};

const readNames = (run: Runner, file: string, args: ReadonlyArray<string>): ReadonlySet<string> | undefined => {
  const result = run(file, args);
  if (!succeeded(result)) return undefined;
  return namesFromJson(result.stdout);
};

const wranglerSecretNames = (run: Runner, environment: SetupEnvironment) => {
  const [file, args] = wrangler(["secret", "list", "--format", "json", ...WRANGLER_ENV_ARGS[environment]]);
  return readNames(run, file, args);
};

export const readSnapshot = (run: Runner, config: WranglerConfig | null): Snapshot => ({
  wranglerVars: Object.fromEntries(SETUP_ENVIRONMENTS.map((environment) => [environment, varNames(config, environment)])) as Record<
    SetupEnvironment,
    ReadonlySet<string>
  >,
  wranglerSecrets: Object.fromEntries(SETUP_ENVIRONMENTS.map((environment) => [environment, wranglerSecretNames(run, environment)])) as Record<
    SetupEnvironment,
    ReadonlySet<string> | undefined
  >,
  ghSecrets: readNames(run, "gh", ["secret", "list", "--json", "name"]),
  ghEnvSecrets: Object.fromEntries(
    [GH_PRODUCTION_ENVIRONMENT, GH_STAGING_ENVIRONMENT].map((name) => [name, readNames(run, "gh", ["secret", "list", "--env", name, "--json", "name"])]),
  ),
  ghVariables: readNames(run, "gh", ["variable", "list", "--json", "name"]),
});

const namesFor = (item: SetupItem, snapshot: Snapshot): ReadonlySet<string> | undefined => {
  if (item.store === "wrangler-var") return snapshot.wranglerVars[item.environment];
  if (item.store === "wrangler-secret") return snapshot.wranglerSecrets[item.environment];
  if (item.store === "gh-secret") return snapshot.ghSecrets;
  if (item.store === "gh-env-secret") return snapshot.ghEnvSecrets[item.ghEnvironment ?? ""];
  return snapshot.ghVariables;
};

export const isSet = (item: SetupItem, snapshot: Snapshot): boolean | undefined => namesFor(item, snapshot)?.has(item.name);

export const commandFor = (item: SetupItem): string =>
  item.secret ? `${SETUP_COMMAND} ${flagOf(item)}=${STDIN_MARK}  (or ${envVarOf(item)}=...)` : `${SETUP_COMMAND} ${flagOf(item)} <value>`;

const statusOf = (item: SetupItem, snapshot: Snapshot): Status => {
  const present = isSet(item, snapshot);
  if (present === true) return "set";
  if (present === undefined) return item.required ? "unread" : "skipped";
  return item.required ? "missing" : "skipped";
};

const halfPair = (item: SetupItem, snapshot: Snapshot): boolean => {
  const partner = item.pairWith === undefined ? undefined : itemById(item.pairWith);
  return partner !== undefined && isSet(partner, snapshot) === true && isSet(item, snapshot) === false;
};

export const evaluate = (snapshot: Snapshot, items: ReadonlyArray<SetupItem> = SETUP_ITEMS): ReadonlyArray<Row> =>
  items.map((item) => ({
    item,
    status: halfPair(item, snapshot) ? "missing" : statusOf(item, snapshot),
    command: commandFor(item),
  }));

export const exitCodeOf = (rows: ReadonlyArray<Row>): number =>
  rows.some((row) => row.item.required && row.status !== "set") || rows.some((row) => row.status === "missing") ? 1 : 0;

const pad = (text: string, width: number): string => text.padEnd(width);

export const renderTable = (rows: ReadonlyArray<Row>): string[] => {
  const labelWidth = Math.max(...rows.map((row) => row.item.label.length), "item".length);
  const envWidth = Math.max(...SETUP_ENVIRONMENTS.map((name) => name.length));
  const head = `${pad("item", labelWidth)}  ${pad("env", envWidth)}  ${pad("status", 7)}  set it with`;
  const lines = rows.map((row) => {
    const need = row.status === "set" ? "" : row.command;
    const tag = row.item.required && row.status !== "set" ? "  (required)" : "";
    return `${pad(row.item.label, labelWidth)}  ${pad(row.item.environment, envWidth)}  ${pad(row.status, 7)}  ${need}${tag}`.trimEnd();
  });
  return [head, ...lines];
};
