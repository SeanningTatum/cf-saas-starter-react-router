import { CONFIG_PATH, SQUASH_TITLE_KEY } from "./repo-rules-constants";
import { differ, rulesetDiffs } from "./repo-rules-diff";
import { pendingChecks, splitPending, withoutMarks, type PendingCheck } from "./repo-rules-pending";
import type { DeclaredRepositoryT, LiveRulesetT, Ruleset } from "./repo-rules-schemas";

interface Finding {
  level: "ok" | "notice" | "missing" | "drift";
  text: string;
  adminOnly?: boolean;
  softWhenFresh?: boolean;
}

export interface Action {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  pending?: boolean;
}

export interface Plan {
  findings: Finding[];
  actions: Action[];
  applied: boolean;
}

export interface FoundRuleset {
  id: number;
  live: LiveRulesetT;
}

const notYetApplied = (subject: string, reason: string): Finding => ({
  level: "notice",
  text: `${subject} is declared but not applied yet (pending: ${reason})`,
});

const markCanGo = (subject: string): Finding => ({
  level: "notice",
  text: `${subject} is live; delete its "pending" mark from ${CONFIG_PATH}`,
});

const checkSubject = (rulesetName: string, p: PendingCheck) => `ruleset "${rulesetName}" check "${p.context}"`;

export function planRuleset(decl: Ruleset, found: FoundRuleset | null, base: string): Plan {
  const name = decl.name;
  const body = withoutMarks(decl);
  if (!found)
    return {
      findings: [{ level: "missing", text: `ruleset "${name}"` }],
      actions: [{ method: "POST", path: `${base}/rulesets`, body, pending: pendingChecks(decl).length > 0 }],
      applied: false,
    };
  const { effective, absent, present } = splitPending(decl, found.live);
  const diffs = rulesetDiffs(effective, found.live);
  const findings: Finding[] = diffs.map((text) => ({ level: "drift", text }));
  if (found.live.bypass_actors === undefined)
    findings.push({ level: "notice", text: `ruleset "${name}" bypass list cannot be read without admin rights; not checked` });
  else if (!diffs.length) findings.push({ level: "ok", text: `ruleset "${name}" matches ${CONFIG_PATH}` });
  findings.push(...absent.map((p) => notYetApplied(checkSubject(name, p), p.reason)), ...present.map((p) => markCanGo(checkSubject(name, p))));
  const needsWrite = diffs.length > 0 || absent.length > 0;
  return {
    findings,
    actions: needsWrite ? [{ method: "PUT", path: `${base}/rulesets/${found.id}`, body, pending: absent.length > 0 }] : [],
    applied: true,
  };
}

export function planRepository(decl: DeclaredRepositoryT, liveTitle: string | undefined, nwo: string): Plan {
  const subject = `repository ${SQUASH_TITLE_KEY}`;
  const declared = decl.squash_merge_commit_title;
  const write: Action = { method: "PATCH", path: `repos/${nwo}`, body: { [SQUASH_TITLE_KEY]: declared }, pending: decl.pending !== undefined };
  if (liveTitle === undefined)
    return {
      findings: [{ level: "notice", text: `${subject} cannot be read with this token; not checked` }],
      actions: [write],
      applied: false,
    };
  if (liveTitle === declared)
    return {
      findings: [{ level: "ok", text: `${subject} matches ${CONFIG_PATH}` }, ...(decl.pending === undefined ? [] : [markCanGo(subject)])],
      actions: [],
      applied: false,
    };
  if (decl.pending !== undefined)
    return {
      findings: [notYetApplied(`${subject} (declared ${declared}, live ${liveTitle})`, decl.pending)],
      actions: [write],
      applied: false,
    };
  const d = differ("repository");
  d.cmp(SQUASH_TITLE_KEY, declared, liveTitle);
  return { findings: d.lines.map((text) => ({ level: "drift", text, softWhenFresh: true })), actions: [write], applied: false };
}
