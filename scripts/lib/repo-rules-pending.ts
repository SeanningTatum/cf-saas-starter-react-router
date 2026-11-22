import { checkEntriesOf, type CheckEntryT, type LiveRulesetT, type Ruleset } from "./repo-rules-schemas";

export interface PendingCheck {
  context: string;
  reason: string;
}

export interface PendingSplit {
  effective: Ruleset;
  absent: PendingCheck[];
  present: PendingCheck[];
}

const checksOf = (ruleset: { rules: Ruleset["rules"] }): readonly CheckEntryT[] =>
  ruleset.rules.flatMap((r) => (r.type === "required_status_checks" ? checkEntriesOf(r.parameters?.required_status_checks) : []));

const rewriteChecks = (ruleset: Ruleset, f: (entries: readonly CheckEntryT[]) => CheckEntryT[]): Ruleset => ({
  ...ruleset,
  rules: ruleset.rules.map((r) => {
    const value = r.type === "required_status_checks" ? r.parameters?.required_status_checks : undefined;
    if (!Array.isArray(value)) return r;
    const entries = checkEntriesOf(value);
    if (entries.length !== value.length) return r;
    return { ...r, parameters: { ...r.parameters, required_status_checks: f(entries) } };
  }),
});

export function pendingChecks(ruleset: Ruleset): PendingCheck[] {
  return checksOf(ruleset).flatMap((c) => (c.pending === undefined ? [] : [{ context: c.context, reason: c.pending }]));
}

export const withoutMarks = (ruleset: Ruleset): Ruleset =>
  rewriteChecks(ruleset, (entries) =>
    entries.map((c) => ({ context: c.context, ...(c.integration_id === undefined ? {} : { integration_id: c.integration_id }) })),
  );

export function splitPending(decl: Ruleset, live: LiveRulesetT): PendingSplit {
  const onLive = new Set(checksOf(live).map((c) => c.context));
  const all = pendingChecks(decl);
  const absent = all.filter((p) => !onLive.has(p.context));
  const dropped = new Set(absent.map((p) => p.context));
  const kept = rewriteChecks(decl, (entries) => entries.filter((c) => !(c.pending !== undefined && dropped.has(c.context))));
  return { effective: withoutMarks(kept), absent, present: all.filter((p) => onLive.has(p.context)) };
}
