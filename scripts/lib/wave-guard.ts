import { Either, Option, Schema } from "effect";
import type { GhRunner } from "./gh";
import {
  COMPLETED_STATUS,
  type GUARD_VERDICTS,
  MERGED_STATE,
  OPEN_STATE,
  PASSING_CONCLUSIONS,
  PENDING_STATES,
  PR_VIEW_FIELDS,
  REPO_VIEW_ARGS,
  THREADS_QUERY,
} from "./wave-constants";

const CheckSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.String),
});

const PrViewSchema = Schema.Struct({
  state: Schema.String,
  baseRefName: Schema.String,
  headRefName: Schema.optional(Schema.String),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRefOid: Schema.String,
  mergeable: Schema.optional(Schema.String),
  statusCheckRollup: Schema.optionalWith(Schema.NullOr(Schema.Array(CheckSchema)), { default: () => [] }),
});

const CommentSchema = Schema.Struct({ author: Schema.NullOr(Schema.Struct({ login: Schema.String })), url: Schema.optional(Schema.String) });
const ThreadSchema = Schema.Struct({ isResolved: Schema.Boolean, comments: Schema.Struct({ nodes: Schema.Array(CommentSchema) }) });
const ThreadsReplySchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.Struct({ pullRequest: Schema.Struct({ reviewThreads: Schema.Struct({ nodes: Schema.Array(ThreadSchema) }) }) }),
  }),
});

export type Check = typeof CheckSchema.Type;
export type PrView = typeof PrViewSchema.Type;
export type Thread = typeof ThreadSchema.Type;

export interface GuardResult {
  verdict: (typeof GUARD_VERDICTS)[number];
  head: string;
  mergeable: string;
  red: string[];
  pending: string[];
  unanswered: string[];
  line: string;
}

const checkName = (c: Check): string => c.name ?? c.context ?? "unnamed check";
const isPass = (c: Check): boolean =>
  c.status !== undefined ? c.status === COMPLETED_STATUS && PASSING_CONCLUSIONS.some((p) => p === c.conclusion) : c.state === PASSING_CONCLUSIONS[0];
const isPending = (c: Check): boolean => (c.status !== undefined ? c.status !== COMPLETED_STATUS : PENDING_STATES.some((p) => p === c.state));

export function sortChecks(checks: readonly Check[]): { red: string[]; pending: string[] } {
  return {
    red: checks.filter((c) => !isPass(c) && !isPending(c)).map(checkName),
    pending: checks.filter(isPending).map(checkName),
  };
}

export function unansweredThreads(threads: readonly Thread[]): string[] {
  return threads.flatMap((t) => {
    if (t.isResolved) return [];
    const authors = t.comments.nodes.map((c) => c.author?.login ?? "");
    const reviewer = authors[0];
    if (reviewer === undefined) return [];
    const lastByReviewer = authors.lastIndexOf(reviewer);
    const replied = authors.slice(lastByReviewer + 1).some((a) => a !== reviewer);
    return replied ? [] : [t.comments.nodes[lastByReviewer]?.url ?? `thread by ${reviewer}`];
  });
}

export function guardDecision(view: PrView, threads: readonly Thread[], wave: string, branch?: string): GuardResult {
  const base = { head: view.headRefOid, mergeable: view.mergeable ?? "", red: [], pending: [], unanswered: [] };
  if (view.state === MERGED_STATE) return { ...base, verdict: "merged", line: "the PR was merged outside the run" };
  if (view.state !== OPEN_STATE) return { ...base, verdict: "closed", line: `the PR is ${view.state.toLowerCase()}` };
  if (view.baseRefName !== wave) return { ...base, verdict: "closed", line: `the PR's base is ${view.baseRefName}, not the wave branch ${wave}` };
  if (branch !== undefined && (view.headRefName !== branch || view.isCrossRepository !== false)) {
    return { ...base, verdict: "closed", line: `the PR's head is not the ticket's own branch ${branch} in this repo` };
  }
  const { red, pending } = sortChecks(view.statusCheckRollup ?? []);
  const unanswered = unansweredThreads(threads);
  const all = { ...base, red, pending, unanswered };
  if (red.length) return { ...all, verdict: "red", line: `red checks: ${red.join(", ")}` };
  if (pending.length || !(view.statusCheckRollup ?? []).length) return { ...all, verdict: "pending", line: "checks are still running" };
  if (unanswered.length) return { ...all, verdict: "threads", line: `${unanswered.length} review thread(s) unanswered` };
  return { ...all, verdict: "green", line: "every check passed and every thread is answered" };
}

const decodeJson = <A, I>(schema: Schema.Schema<A, I>, text: string): Option.Option<A> => Schema.decodeUnknownOption(Schema.parseJson(schema))(text);

export function readGuard(gh: GhRunner, pr: number, wave: string, branch?: string): Either.Either<GuardResult, string> {
  const repo = gh(REPO_VIEW_ARGS);
  const [owner, name] = repo.stdout.trim().split("/");
  if (repo.code !== 0 || !owner || !name) return Either.left(`gh repo view: ${repo.stderr.trim() || "no repository"}`);
  const view = gh(["pr", "view", String(pr), "--json", PR_VIEW_FIELDS]);
  if (view.code !== 0) return Either.left(`gh pr view ${pr}: ${view.stderr.trim()}`);
  const parsedView = decodeJson(PrViewSchema, view.stdout);
  if (Option.isNone(parsedView)) return Either.left(`gh pr view ${pr}: unexpected output`);
  const threads = gh(["api", "graphql", "-f", `query=${THREADS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `pr=${pr}`]);
  if (threads.code !== 0) return Either.left(`gh api graphql (review threads of ${pr}): ${threads.stderr.trim()}`);
  const parsedThreads = decodeJson(ThreadsReplySchema, threads.stdout);
  if (Option.isNone(parsedThreads)) return Either.left(`gh api graphql (review threads of ${pr}): unexpected output`);
  return Either.right(guardDecision(parsedView.value, parsedThreads.value.data.repository.pullRequest.reviewThreads.nodes, wave, branch));
}

export function mergePr(gh: GhRunner, pr: number, head: string): Either.Either<true, string> {
  const r = gh(["pr", "merge", String(pr), "--squash", "--match-head-commit", head]);
  return r.code === 0 ? Either.right(true) : Either.left(r.stderr.trim() || r.stdout.trim() || `gh pr merge exited ${r.code}`);
}
