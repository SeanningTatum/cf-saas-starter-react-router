import { PRODUCTION_ENVIRONMENT, SEED_SECRET_NAME } from "./setup-constants";
import type { Entry, Plan } from "./setup-plan";
import { itemById, type SetupItem } from "./setup-items";
import { isSet, type Snapshot } from "./setup-readiness";
import { putNamedGhSecret, putItem, type StoreContext } from "./setup-stores";
import { applyVarEdits, missingBlocks, type VarEdit, type WranglerConfig } from "./setup-wrangler-vars";

export interface Applied {
  readonly item: SetupItem;
  readonly source: Entry["source"];
  readonly error: string | undefined;
}

export interface ApplyDeps {
  readonly context: StoreContext;
  readonly config: WranglerConfig | null;
  readonly writeConfig: (config: WranglerConfig) => void;
  readonly generateSecret: () => string;
  readonly saveLocalEnv: (key: string, value: string) => void;
  readonly snapshot: Snapshot;
}

export interface ApplyOutcome {
  readonly applied: ReadonlyArray<Applied>;
  readonly notes: ReadonlyArray<string>;
  readonly varsChanged: boolean;
}

const VAR_STORE = "wrangler-var";

const varEditsOf = (entries: ReadonlyArray<Entry>): ReadonlyArray<VarEdit> =>
  entries.flatMap(({ item, value }) => [
    ...(item.store === VAR_STORE ? [{ environment: item.environment, name: item.name, value }] : []),
    ...(item.companion ? [{ environment: item.environment, name: item.companion.name, value: item.companion.value }] : []),
  ]);

const applyVars = (entries: ReadonlyArray<Entry>, deps: ApplyDeps, failed: ReadonlySet<string>): { applied: Applied[]; notes: string[]; changed: boolean } => {
  const varEntries = entries.filter(({ item }) => item.store === VAR_STORE || item.companion !== undefined);
  const held = varEntries.filter(({ item }) => item.store === VAR_STORE && item.pairWith !== undefined && failed.has(item.pairWith));
  const live = varEntries.filter((entry) => !held.includes(entry) && !failed.has(entry.item.id));
  const heldApplied = held.map(({ item, source }) => ({ item, source, error: `not saved: the paired secret ${item.pairWith} was not stored` }));
  const edits = varEditsOf(live);
  if (edits.length === 0) return { applied: heldApplied, notes: [], changed: false };
  if (deps.config === null) {
    const unread = live.map(({ item, source }) => ({ item, source, error: "wrangler.jsonc cannot be read" }));
    return { applied: [...heldApplied, ...unread], notes: [], changed: false };
  }
  const absent = missingBlocks(deps.config, edits);
  const usable = edits.filter((edit) => !absent.includes(edit.environment));
  if (usable.length > 0) deps.writeConfig(applyVarEdits(deps.config, usable));
  const applied = live.map(({ item, source }) => ({
    item,
    source,
    error: absent.includes(item.environment) ? `wrangler.jsonc has no ${item.environment} block` : undefined,
  }));
  return {
    applied: [...heldApplied, ...applied],
    notes: usable.length > 0 ? ["wrangler.jsonc changed: commit it, then redeploy so the Worker reads the new values"] : [],
    changed: usable.length > 0,
  };
};

const seedNotes = (deps: ApplyDeps, applied: ReadonlyArray<Applied>): string[] => {
  const previewItem = itemById("preview-token");
  const uploaded = applied.some((entry) => entry.item.id === "preview-token" && entry.error === undefined);
  const existing = previewItem !== undefined && isSet(previewItem, deps.snapshot) === true && deps.snapshot.ghSecrets !== undefined;
  if (!(uploaded || existing) || deps.snapshot.ghSecrets?.has(SEED_SECRET_NAME) === true) return [];
  const seed = deps.generateSecret();
  const error = putNamedGhSecret(SEED_SECRET_NAME, seed, deps.context);
  if (error !== undefined) return [`${SEED_SECRET_NAME} was not set: ${error}; run setup again to retry`];
  deps.saveLocalEnv(SEED_SECRET_NAME, seed);
  return [`${SEED_SECRET_NAME} set and saved to .env`];
};

export const applyPlan = (plan: Plan, deps: ApplyDeps): ApplyOutcome => {
  const stored = plan.entries
    .filter(({ item }) => item.store !== VAR_STORE)
    .map(({ item, value, source }) => ({ item, source, error: putItem(item, value, deps.context) }));
  const failed = new Set(stored.filter((entry) => entry.error !== undefined).map((entry) => entry.item.id));
  const vars = applyVars(plan.entries, deps, failed);
  const companionErrors = new Map(vars.applied.map((entry) => [entry.item.id, entry.error]));
  const settled = stored.map((entry) => (entry.error === undefined && entry.item.companion ? { ...entry, error: companionErrors.get(entry.item.id) } : entry));
  const applied = [...vars.applied.filter((entry) => entry.item.store === VAR_STORE), ...settled];
  const notes = [...vars.notes, ...seedNotes(deps, applied)];
  return { applied, notes, varsChanged: vars.changed };
};

export const describeApplied = (entry: Applied): string => {
  const where = entry.item.environment === PRODUCTION_ENVIRONMENT ? "" : ` (${entry.item.environment})`;
  const how = entry.source === "generated" ? "generated" : "set";
  return entry.error === undefined ? `ok: ${entry.item.label}${where} ${how}` : `failed: ${entry.item.label}${where}: ${entry.error}`;
};
