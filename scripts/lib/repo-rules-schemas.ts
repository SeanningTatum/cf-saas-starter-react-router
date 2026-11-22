import { Either, Schema } from "effect";

const Params = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const Rule = Schema.Struct({ type: Schema.String, parameters: Schema.optional(Params) });

const DeclaredRuleset = Schema.Struct({
  name: Schema.String,
  target: Schema.String,
  enforcement: Schema.String,
  bypass_actors: Schema.Array(Schema.Unknown),
  conditions: Schema.Struct({
    ref_name: Schema.Struct({ include: Schema.Array(Schema.String), exclude: Schema.Array(Schema.String) }),
  }),
  rules: Schema.Array(Rule),
});

const PathSafe = Schema.String.pipe(
  Schema.filter((s) => s.length > 0 && !/\.\.|[?#{\s]/.test(s), {
    message: () => "must not be empty or contain '..', '?', '#', '{' or whitespace",
  }),
);

const ReviewerName = Schema.String.pipe(
  Schema.filter((s) => s === "@owner" || /^[A-Za-z0-9-]+$/.test(s) || (/^[A-Za-z0-9-]+\/[\w-][\w.-]*$/.test(s) && !s.includes("..")), {
    message: () => "a reviewer is @owner, a GitHub login, or org/team-slug",
  }),
);

const DeclaredEnv = Schema.Struct({
  name: PathSafe,
  reviewers: Schema.Array(ReviewerName),
  prevent_self_review: Schema.Boolean,
  deployment_branches: Schema.Array(PathSafe),
});

const PendingReason = Schema.String.pipe(
  Schema.filter((s) => s.trim().length > 0, { message: () => "pending must be a non-empty string" }),
);

const DeclaredRepository = Schema.Struct({
  squash_merge_commit_title: Schema.Literal("PR_TITLE", "COMMIT_OR_PR_TITLE"),
  pending: Schema.optional(PendingReason),
});

export const Config = Schema.Struct({
  rulesets: Schema.Array(DeclaredRuleset).pipe(Schema.minItems(1)),
  environments: Schema.Array(DeclaredEnv),
  repository: Schema.optional(DeclaredRepository),
});

export type Ruleset = typeof DeclaredRuleset.Type;
export type DeclaredEnvironment = typeof DeclaredEnv.Type;
export type DeclaredRepositoryT = typeof DeclaredRepository.Type;
export type ConfigT = typeof Config.Type;

const OldShape = Schema.Struct({ ruleset: Schema.Unknown, rulesets: Schema.optional(Schema.Unknown) });

export const hasOldShape = (text: string): boolean => {
  const decoded = Schema.decodeUnknownEither(Schema.parseJson(OldShape))(text);
  return Either.isRight(decoded) && decoded.right.rulesets === undefined;
};

export const RepoInfo = Schema.Struct({
  default_branch: Schema.String,
  squash_merge_commit_title: Schema.optional(Schema.String),
  owner: Schema.Struct({ login: Schema.String, id: Schema.Number, type: Schema.String }),
  permissions: Schema.optional(Schema.Struct({ admin: Schema.optional(Schema.Boolean) })),
});

export const RulesetList = Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String }));

export const LiveRuleset = Schema.Struct({
  target: Schema.String,
  enforcement: Schema.String,
  bypass_actors: Schema.optional(Schema.Array(Schema.Unknown)),
  conditions: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        ref_name: Schema.optional(
          Schema.Struct({
            include: Schema.optional(Schema.Array(Schema.String)),
            exclude: Schema.optional(Schema.Array(Schema.String)),
          }),
        ),
      }),
    ),
  ),
  rules: Schema.Array(Rule),
});

export const LiveEnv = Schema.Struct({
  protection_rules: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        prevent_self_review: Schema.optional(Schema.Boolean),
        reviewers: Schema.optional(
          Schema.Array(
            Schema.Struct({
              type: Schema.String,
              reviewer: Schema.Struct({
                id: Schema.Number,
                login: Schema.optional(Schema.String),
                slug: Schema.optional(Schema.String),
              }),
            }),
          ),
        ),
      }),
    ),
  ),
  deployment_branch_policy: Schema.optional(
    Schema.NullOr(Schema.Struct({ protected_branches: Schema.Boolean, custom_branch_policies: Schema.Boolean })),
  ),
});

export const BranchPolicies = Schema.Struct({
  branch_policies: Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String })),
});

export const IdOnly = Schema.Struct({ id: Schema.Number });

const CheckEntry = Schema.Struct({
  context: Schema.String,
  integration_id: Schema.optional(Schema.Number),
  pending: Schema.optional(PendingReason),
});
const CheckEntries = Schema.Array(CheckEntry);

export type CheckEntryT = typeof CheckEntry.Type;

export const checkEntriesOf = (v: unknown): readonly CheckEntryT[] => {
  const d = Schema.decodeUnknownEither(CheckEntries)(v);
  return Either.isRight(d) ? d.right : [];
};

const ContextOnly = Schema.Struct({ context: Schema.String });

export function checkProblems(rulesets: readonly Ruleset[]): string[] {
  const rawEntries = (v: unknown): readonly unknown[] => {
    const d = Schema.decodeUnknownEither(Schema.Array(Schema.Unknown))(v);
    return Either.isRight(d) ? d.right : [];
  };
  return rulesets.flatMap((rs) =>
    rs.rules.flatMap((r) =>
      r.type !== "required_status_checks"
        ? []
        : rawEntries(r.parameters?.required_status_checks).flatMap((e) => {
            const bad = Schema.decodeUnknownEither(CheckEntry)(e);
            if (Either.isRight(bad)) return [];
            const name = Schema.decodeUnknownEither(ContextOnly)(e);
            const label = Either.isRight(name) ? name.right.context : "?";
            return [`ruleset "${rs.name}" check "${label}" is not valid: ${bad.left.message.replace(/\s+/g, " ").trim()}`];
          }),
    ),
  );
}

export type LiveRulesetT = typeof LiveRuleset.Type;
export type LiveEnvT = typeof LiveEnv.Type;
