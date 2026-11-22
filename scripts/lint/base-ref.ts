export interface BaseDeps {
  env: Record<string, string | undefined>;
  git(args: string[]): string | undefined;
  pullRequestTarget(): string | undefined;
}

export type Base =
  | { found: true; sha: string; from: string }
  | { found: false; required: boolean; tried: string[] };

interface Candidate {
  from: string;
  branch: string | undefined;
}

function resolve(git: BaseDeps["git"], branch: string): string | undefined {
  if (branch.startsWith("-")) return undefined;
  for (const ref of [`origin/${branch}`, branch]) {
    const tip = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (tip) return git(["merge-base", "HEAD", ref]) ?? tip;
  }
  return undefined;
}

function defaultBranch(git: BaseDeps["git"]): string | undefined {
  return git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.replace(/^origin\//, "");
}

function recordedTarget(git: BaseDeps["git"]): string | undefined {
  const current = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return current && current !== "HEAD" ? git(["config", "--get", `branch.${current}.gh-merge-base`]) : undefined;
}

export function resolveBase(deps: BaseDeps): Base {
  const ciBase = deps.env.GITHUB_BASE_REF || undefined;
  const candidates: Candidate[] = ciBase
    ? [{ from: "GITHUB_BASE_REF", branch: ciBase }]
    : [
        { from: "the pull request's target", branch: recordedTarget(deps.git) ?? deps.pullRequestTarget() },
        { from: "the default branch", branch: defaultBranch(deps.git) },
      ];
  const tried: string[] = [];
  for (const { from, branch } of candidates) {
    if (!branch) continue;
    const sha = resolve(deps.git, branch);
    if (sha) return { found: true, sha, from: `${from}, ${branch}` };
    tried.push(branch);
  }
  return { found: false, required: ciBase !== undefined, tried };
}

export function readAtBase(git: BaseDeps["git"], sha: string, path: string): string | undefined {
  return git(["show", `${sha}:${path}`]);
}
