import { DUMMY_DATABASE_ID, SETUP_ENVIRONMENTS, type SetupEnvironment } from "./setup-constants";

export type WranglerConfig = Record<string, unknown>;

export interface VarEdit {
  readonly environment: SetupEnvironment;
  readonly name: string;
  readonly value: string;
}

const VARS_KEY = "vars";
const ENV_KEY = "env";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const blockOf = (config: WranglerConfig, environment: SetupEnvironment): Record<string, unknown> | undefined => {
  if (environment === "production") return config;
  const envs = config[ENV_KEY];
  const block = isRecord(envs) ? envs[environment] : undefined;
  return isRecord(block) ? block : undefined;
};

export const varsOf = (config: WranglerConfig | null, environment: SetupEnvironment): Record<string, unknown> => {
  const block = config === null ? undefined : blockOf(config, environment);
  const vars = block?.[VARS_KEY];
  return isRecord(vars) ? vars : {};
};

export const varNames = (config: WranglerConfig | null, environment: SetupEnvironment): ReadonlySet<string> =>
  new Set(Object.keys(varsOf(config, environment)));

export const isProvisioned = (config: WranglerConfig | null): boolean => {
  const databases = config?.d1_databases;
  if (!Array.isArray(databases) || databases.length === 0) return false;
  return databases.every((database) => isRecord(database) && typeof database.database_id === "string" && database.database_id !== DUMMY_DATABASE_ID);
};

export const preserveVars = (existing: WranglerConfig | null, fresh: WranglerConfig): WranglerConfig => {
  if (existing === null) return fresh;
  const next: WranglerConfig = { ...fresh };
  const kept = existing[VARS_KEY];
  if (isRecord(kept)) next[VARS_KEY] = { ...kept };
  const freshEnvs = isRecord(fresh[ENV_KEY]) ? fresh[ENV_KEY] : {};
  const envs: Record<string, unknown> = { ...freshEnvs };
  for (const environment of SETUP_ENVIRONMENTS) {
    if (environment === "production") continue;
    const block = blockOf(existing, environment);
    const target = envs[environment];
    const vars = block?.[VARS_KEY];
    if (isRecord(vars) && isRecord(target)) envs[environment] = { ...target, [VARS_KEY]: { ...vars } };
  }
  if (Object.keys(envs).length > 0) next[ENV_KEY] = envs;
  return next;
};

export const applyVarEdits = (config: WranglerConfig, edits: ReadonlyArray<VarEdit>): WranglerConfig => {
  const next: WranglerConfig = structuredClone(config);
  for (const edit of edits) {
    const block = blockOf(next, edit.environment);
    if (block === undefined) continue;
    const current = block[VARS_KEY];
    block[VARS_KEY] = { ...(isRecord(current) ? current : {}), [edit.name]: edit.value };
  }
  return next;
};

export const missingBlocks = (config: WranglerConfig, edits: ReadonlyArray<VarEdit>): ReadonlyArray<SetupEnvironment> => [
  ...new Set(edits.filter((edit) => blockOf(config, edit.environment) === undefined).map((edit) => edit.environment)),
];
