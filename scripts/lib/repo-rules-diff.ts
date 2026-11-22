import { checkEntriesOf, type LiveRulesetT, type Ruleset } from "./repo-rules-schemas";

export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}

const show = (v: unknown) => (v === undefined ? "absent" : JSON.stringify(v));
export const sorted = (xs: readonly string[]) => [...xs].sort();

export function differ(prefix: string) {
  const lines: string[] = [];
  return {
    lines,
    cmp(field: string, declared: unknown, live: unknown) {
      if (stable(declared) !== stable(live)) lines.push(`${prefix} ${field}: declared ${show(declared)}, live ${show(live)}`);
    },
  };
}

const labelOf = (context: string, integrationId: number | undefined) =>
  integrationId === undefined ? context : `${context} (app ${integrationId})`;

function declaredCheckLabels(v: unknown): string[] {
  return sorted(checkEntriesOf(v).map((c) => labelOf(c.context, c.integration_id)));
}

function liveCheckLabels(declared: unknown, live: unknown): string[] {
  const declaredEntries = checkEntriesOf(declared);
  return sorted(
    checkEntriesOf(live).map((c) => {
      const pinned = declaredEntries.find((d) => d.context === c.context)?.integration_id !== undefined;
      return labelOf(c.context, pinned ? c.integration_id : undefined);
    }),
  );
}

export function rulesetDiffs(decl: Ruleset, live: LiveRulesetT): string[] {
  const d = differ(`ruleset "${decl.name}"`);
  const actors = (xs: readonly unknown[]) => xs.map(stable).sort();
  if (live.bypass_actors !== undefined) d.cmp("bypass_actors", actors(decl.bypass_actors), actors(live.bypass_actors));
  d.cmp("target", decl.target, live.target);
  d.cmp("enforcement", decl.enforcement, live.enforcement);
  const ref = live.conditions?.ref_name;
  d.cmp("conditions.ref_name.include", sorted(decl.conditions.ref_name.include), sorted(ref?.include ?? []));
  d.cmp("conditions.ref_name.exclude", sorted(decl.conditions.ref_name.exclude), sorted(ref?.exclude ?? []));

  const liveByType = new Map(live.rules.map((r) => [r.type, r]));
  for (const r of decl.rules) {
    const l = liveByType.get(r.type);
    if (!l) {
      d.lines.push(`ruleset "${decl.name}" rules.${r.type}: declared present, live absent`);
      continue;
    }
    for (const [key, value] of Object.entries(r.parameters ?? {})) {
      const field = `rules.${r.type}.${key}`;
      const liveValue = l.parameters?.[key];
      if (r.type === "required_status_checks" && key === "required_status_checks")
        d.cmp(field, declaredCheckLabels(value), liveValue === undefined ? undefined : liveCheckLabels(value, liveValue));
      else d.cmp(field, value, liveValue);
    }
  }
  const declaredTypes = new Set(decl.rules.map((r) => r.type));
  for (const t of liveByType.keys())
    if (!declaredTypes.has(t)) d.lines.push(`ruleset "${decl.name}" rules.${t}: declared absent, live present`);
  return d.lines;
}
