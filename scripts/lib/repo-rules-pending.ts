import { PENDING_KEY } from "./repo-rules-constants";
import { checkEntriesOf, type LiveRulesetT, type Ruleset } from "./repo-rules-schemas";

export interface PendingCheck {
  context: string;
  reason: string;
}

export interface PendingSplit {
  effective: Ruleset;
  absent: PendingCheck[];
  present: PendingCheck[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const asEntries = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

const reasonOf = (entry: unknown): string | undefined => {
  if (!isRecord(entry)) return undefined;
  const value = entry[PENDING_KEY];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const contextOf = (entry: unknown): string | undefined => {
  if (!isRecord(entry)) return undefined;
  const value = entry.context;
  return typeof value === "string" ? value : undefined;
};

const checkEntriesIn = (ruleset: Ruleset): readonly unknown[] =>
  ruleset.rules.flatMap((r) => (r.type === "required_status_checks" ? asEntries(r.parameters?.required_status_checks) : []));

const rewriteEntries = (ruleset: Ruleset, f: (entries: readonly unknown[]) => unknown[]): Ruleset => ({
  ...ruleset,
  rules: ruleset.rules.map((r) => {
    const entries = r.type === "required_status_checks" ? r.parameters?.required_status_checks : undefined;
    if (!Array.isArray(entries)) return r;
    return { ...r, parameters: { ...r.parameters, required_status_checks: f(entries) } };
  }),
});

export function pendingChecks(ruleset: Ruleset): PendingCheck[] {
  return checkEntriesIn(ruleset).flatMap((e) => {
    const reason = reasonOf(e);
    const context = contextOf(e);
    return reason !== undefined && context !== undefined ? [{ context, reason }] : [];
  });
}

export function badPendingMarks(rulesets: readonly Ruleset[]): string[] {
  return rulesets.flatMap((rs) =>
    checkEntriesIn(rs)
      .filter((e) => isRecord(e) && PENDING_KEY in e && reasonOf(e) === undefined)
      .map((e) => `ruleset "${rs.name}" check "${contextOf(e) ?? "?"}": "${PENDING_KEY}" must be a non-empty string`),
  );
}

export function withoutMarks(ruleset: Ruleset): Ruleset {
  return rewriteEntries(ruleset, (entries) =>
    entries.map((e) => (isRecord(e) ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== PENDING_KEY)) : e)),
  );
}

const liveContexts = (live: LiveRulesetT): Set<string> =>
  new Set(
    live.rules.flatMap((r) =>
      r.type === "required_status_checks" ? checkEntriesOf(r.parameters?.required_status_checks).map((c) => c.context) : [],
    ),
  );

export function splitPending(decl: Ruleset, live: LiveRulesetT): PendingSplit {
  const onLive = liveContexts(live);
  const all = pendingChecks(decl);
  const absent = all.filter((p) => !onLive.has(p.context));
  const present = all.filter((p) => onLive.has(p.context));
  const dropped = new Set(absent.map((p) => p.context));
  const kept = rewriteEntries(decl, (entries) =>
    entries.filter((e) => !(reasonOf(e) !== undefined && dropped.has(contextOf(e) ?? ""))),
  );
  return { effective: withoutMarks(kept), absent, present };
}
