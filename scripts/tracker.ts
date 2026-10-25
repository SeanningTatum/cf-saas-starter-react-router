/**
 * Issue-tracker adapter for the plan-feature workflow.
 *
 * The workflow reads a ticket, writes the decision record back as an issue comment and edits the
 * ticket body. It does that through this one script so the tracker is swappable and the workflow
 * never builds a `gh` command line itself. Spec: plans/plan-feature-contract.md section 2.
 *
 *   bun run tracker view <ref>
 *   bun run tracker create --title <t> --body-file <f> [--label <l>]...
 *   bun run tracker edit <ref> --body-file <f> [--title <t>] [--if-updated-at <iso>]
 *   bun run tracker comment <ref> --body-file <f>
 *   bun run tracker upsert-comment <ref> --marker <key> --body-file <f>
 *
 * <ref> is `12`, `#12` or a full https://github.com/<owner>/<repo>/issues/12 URL.
 * Success prints one JSON object to stdout. Failure prints { error, code, help } to stderr.
 * Exit codes: 0 ok, 1 USAGE, 2 NOT_FOUND or AUTH, 3 STALE, 4 BACKEND.
 *
 * `edit --if-updated-at` guards against lost updates in two steps. GitHub has no conditional issue
 * edit, so a read-then-write race cannot be closed: (1) before writing, updatedAt must equal the
 * given value, else exit 3 STALE and nothing is written; (2) after writing, the issue's last 10
 * userContentEdits are read, and any edit by someone other than the current `gh` user dated after
 * the checked updatedAt and before our write exits 3 STALE_AFTER_WRITE, with that edit's diff in
 * the error JSON `body`. The write has landed by then, so the caller restores or merges. Remaining
 * limits: an edit that lands after our write goes unseen, GitHub may lag in listing edits, and
 * only the 10 newest edits are read. Exit 3 means "look again", never "safe".
 *
 * The `gh` process and the file reader are injected (`Deps`), so the tests run with no network.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs `gh <args>` and reports what happened. Never throws. */
export type GhRunner = (args: string[]) => GhResult;

export interface Deps {
  gh: GhRunner;
  readFile: (path: string) => string;
  /** ISO time of "now"; injected so tests control the write timestamp. */
  now?: () => string;
}

export interface Outcome {
  code: number;
  out?: unknown;
  err?: { error: string; code: string; help: string; body?: string };
}

const ok = (out: unknown): Outcome => ({ code: 0, out });
const bad = (code: number, kind: string, error: string, help: string): Outcome => ({
  code,
  err: { error, code: kind, help },
});
const usage = (error: string): Outcome =>
  bad(
    1,
    "USAGE",
    error,
    "verbs: view <ref> | create --title --body-file | edit <ref> --body-file | comment <ref> --body-file | upsert-comment <ref> --marker --body-file",
  );

export const defaultDeps: Deps = {
  gh: (args) => {
    const r = spawnSync("gh", args, { encoding: "utf8" });
    if (r.error) return { code: 127, stdout: "", stderr: `cannot run gh: ${r.error.message}` };
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },
  readFile: (p) => readFileSync(p, "utf8"),
};

interface Ref {
  number: number;
  /** `owner/repo` when the ref was a URL. */
  repo?: string;
}

function parseRef(raw: string | undefined): Ref | null {
  if (!raw) return null;
  const url = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)\/?(?:[#?].*)?$/.exec(raw);
  if (url) return { repo: url[1], number: Number(url[2]) };
  const num = /^#?(\d+)$/.exec(raw);
  return num ? { number: Number(num[1]) } : null;
}

/** Turn a failed gh call into the contract's error shape. */
function ghFailure(r: GhResult): Outcome {
  const text = r.stderr.trim() || r.stdout.trim() || `gh exited ${r.code}`;
  if (r.code === 127) return bad(2, "AUTH", text, "install the GitHub CLI and run: gh auth login");
  if (/auth login|not logged in|authentication|GH_TOKEN|HTTP 401/i.test(text))
    return bad(2, "AUTH", text, "run: gh auth login");
  if (/could not resolve|not found|HTTP 404|no issue|no pull request/i.test(text))
    return bad(2, "NOT_FOUND", text, "check the issue number and the repository");
  return bad(2, "NOT_FOUND", text, "gh failed; run the same gh command by hand to see why");
}

interface Parsed {
  verb: string;
  positional: string[];
  flags: Map<string, string[]>;
  backend: string;
}

function parseArgs(argv: string[]): Parsed | string {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return `${a} needs a value`;
      flags.set(a, [...(flags.get(a) ?? []), v]);
      i++;
    } else positional.push(a);
  }
  const [verb = "", ...rest] = positional;
  return { verb, positional: rest, flags, backend: flags.get("--backend")?.[0] ?? "gh" };
}

/** Flags each verb accepts besides --backend. An unknown flag is a typo, never silently ignored. */
const FLAGS: Record<string, string[]> = {
  view: [],
  create: ["--title", "--body-file", "--label"],
  edit: ["--body-file", "--title", "--if-updated-at"],
  comment: ["--body-file"],
  "upsert-comment": ["--marker", "--body-file"],
};

const one = (p: Parsed, f: string) => p.flags.get(f)?.[0];

/** `-R owner/repo` for gh issue commands, when the ref named a repo. */
const repoArgs = (ref: Ref) => (ref.repo ? ["-R", ref.repo] : []);

const ISSUE_FIELDS = "number,url,title,body,state,labels,updatedAt,comments";

async function viewJson(ref: Ref, deps: Deps, fields = ISSUE_FIELDS): Promise<Outcome & { data?: any }> {
  const r = deps.gh(["issue", "view", String(ref.number), ...repoArgs(ref), "--json", fields]);
  if (r.code !== 0) return ghFailure(r);
  try {
    return { code: 0, data: JSON.parse(r.stdout) };
  } catch {
    return bad(2, "NOT_FOUND", "gh returned unreadable JSON", "run: gh issue view <n> --json " + fields);
  }
}

/** `owner/repo` for gh api paths: from the URL ref, else from the current checkout. */
function resolveRepo(ref: Ref, deps: Deps): { repo: string } | Outcome {
  if (ref.repo) return { repo: ref.repo };
  const r = deps.gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const repo = r.stdout.trim();
  if (r.code !== 0 || !repo) return ghFailure(r.code !== 0 ? r : { ...r, stderr: "could not resolve the repository" });
  return { repo };
}

function readBody(p: Parsed, deps: Deps): { body: string; path: string } | Outcome {
  const path = one(p, "--body-file");
  if (!path) return usage("--body-file is required");
  try {
    return { body: deps.readFile(path), path };
  } catch (e) {
    return usage(`cannot read ${path}: ${(e as Error).message}`);
  }
}

const isOutcome = (v: unknown): v is Outcome => typeof v === "object" && v !== null && "code" in v;

async function view(ref: Ref, deps: Deps): Promise<Outcome> {
  const v = await viewJson(ref, deps);
  if (v.err) return v;
  const d = v.data;
  return ok({
    ref: `#${d.number}`,
    number: d.number,
    url: d.url,
    title: d.title,
    body: d.body,
    state: d.state,
    labels: (d.labels ?? []).map((l: { name: string }) => l.name),
    updatedAt: d.updatedAt,
    comments: (d.comments ?? []).map((c: any) => ({
      id: c.id,
      author: c.author?.login ?? "",
      body: c.body,
      url: c.url,
    })),
  });
}

function create(p: Parsed, deps: Deps): Outcome {
  const title = one(p, "--title");
  if (!title) return usage("--title is required");
  const body = readBody(p, deps);
  if (isOutcome(body)) return body;
  const labels = (p.flags.get("--label") ?? []).flatMap((l) => ["--label", l]);
  const r = deps.gh(["issue", "create", "--title", title, "--body-file", body.path, ...labels]);
  if (r.code !== 0) return ghFailure(r);
  const url = r.stdout.trim().split("\n").pop() ?? "";
  const n = /\/issues\/(\d+)/.exec(url)?.[1];
  if (!n) return bad(2, "NOT_FOUND", `gh did not print an issue URL: ${url}`, "check: gh issue list");
  return ok({ ref: `#${n}`, number: Number(n), url });
}

async function edit(ref: Ref, p: Parsed, deps: Deps): Promise<Outcome> {
  const body = readBody(p, deps);
  if (isOutcome(body)) return body;
  const expect = one(p, "--if-updated-at");
  if (expect) {
    const v = await viewJson(ref, deps, "updatedAt");
    if (v.err) return v;
    if (v.data.updatedAt !== expect)
      return bad(
        3,
        "STALE",
        `issue changed since ${expect} (now ${v.data.updatedAt}); nothing written`,
        "run: tracker view <ref>, merge the new text, then retry with the new updatedAt",
      );
  }
  const title = one(p, "--title");
  // Needed for the post-write check; fetch before writing so a failure here writes nothing.
  let nodeId = "";
  let me = "";
  if (expect) {
    const idv = await viewJson(ref, deps, "id");
    if (idv.err) return idv;
    nodeId = idv.data.id;
    const u = deps.gh(["api", "user", "-q", ".login"]);
    if (u.code !== 0) return ghFailure(u);
    me = u.stdout.trim();
  }
  const writeAt = (deps.now ?? (() => new Date().toISOString()))();
  const r = deps.gh(["issue", "edit", String(ref.number), ...repoArgs(ref), "--body-file", body.path, ...(title ? ["--title", title] : [])]);
  if (r.code !== 0) return ghFailure(r);
  if (expect) {
    const q = deps.gh([
      "api",
      "graphql",
      "-f",
      "query=query($id:ID!){node(id:$id){... on Issue{userContentEdits(last:10){nodes{editor{login} editedAt diff}}}}}",
      "-f",
      `id=${nodeId}`,
    ]);
    if (q.code !== 0) return ghFailure(q);
    let nodes: { editor?: { login?: string } | null; editedAt: string; diff?: string | null }[] = [];
    try {
      nodes = JSON.parse(q.stdout).data.node.userContentEdits.nodes ?? [];
    } catch {
      return bad(2, "NOT_FOUND", "gh api graphql returned unreadable JSON", "the write landed; run: tracker view <ref> and check the body");
    }
    // The bound is our own completed write, not the clock before we ran: an edit that lands while
    // `gh issue edit` is in flight sits after writeAt but before our edit. With no own edit on
    // record (an unchanged body creates none), fall back to the pre-write clock. GitHub stamps edits
    // to the second, so an edit in the same second as the bound is a conflict too: one of the two
    // writes overwrote the other.
    const ours = nodes
      .filter((n) => n.editor?.login === me && n.editedAt > expect)
      .sort((a, b) => (a.editedAt < b.editedAt ? 1 : -1))[0];
    const bound = ours && ours.editedAt > writeAt ? ours.editedAt : writeAt;
    const other = nodes
      .filter((n) => n.editor?.login !== me && n.editedAt > expect && n.editedAt <= bound)
      .sort((a, b) => (a.editedAt < b.editedAt ? 1 : -1))[0];
    if (other) {
      const err = bad(
        3,
        "STALE_AFTER_WRITE",
        `${other.editor?.login ?? "someone"} edited the issue at ${other.editedAt}, after ${expect} and before our write finished; our write may have overwritten it`,
        "the write landed; restore or merge the text in `body` (that edit's diff), then edit again",
      );
      err.err!.body = other.diff ?? "";
      return err;
    }
  }
  const after = await viewJson(ref, deps, "url,updatedAt");
  if (after.err) return after;
  return ok({ ref: `#${ref.number}`, url: after.data.url, updatedAt: after.data.updatedAt });
}

function comment(ref: Ref, p: Parsed, deps: Deps): Outcome {
  const body = readBody(p, deps);
  if (isOutcome(body)) return body;
  const r = deps.gh(["issue", "comment", String(ref.number), ...repoArgs(ref), "--body-file", body.path]);
  if (r.code !== 0) return ghFailure(r);
  const url = r.stdout.trim().split("\n").pop() ?? "";
  const id = /issuecomment-(\d+)/.exec(url)?.[1];
  if (!id) return bad(2, "NOT_FOUND", `gh did not print a comment URL: ${url}`, "check the issue on GitHub");
  return ok({ id, url });
}

function upsertComment(ref: Ref, p: Parsed, deps: Deps): Outcome {
  const key = one(p, "--marker");
  if (!key) return usage("--marker is required");
  const file = readBody(p, deps);
  if (isOutcome(file)) return file;
  const repo = resolveRepo(ref, deps);
  if ("code" in repo) return repo;
  const marker = `<!-- plan-feature:${key} -->`;
  const body = `${marker}\n${file.body}`;

  // Only the current gh user can edit their own comment, so who wrote the marked comment matters.
  const u = deps.gh(["api", "user", "-q", ".login"]);
  if (u.code !== 0) return ghFailure(u);
  const me = u.stdout.trim();

  // --jq makes gh print one JSON object per line.
  const list = deps.gh([
    "api",
    "--paginate",
    `repos/${repo.repo}/issues/${ref.number}/comments`,
    "--jq",
    ".[] | {id, html_url, body, author: .user.login}",
  ]);
  if (list.code !== 0) return ghFailure(list);
  const marked = list.stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as { id: number; html_url: string; body: string; author?: string };
      } catch {
        return null;
      }
    })
    .filter((c): c is { id: number; html_url: string; body: string; author?: string } => !!c?.body?.includes(marker));
  // Newest own marked comment wins; comment ids grow with time.
  const mine = marked.filter((c) => c.author === me).sort((a, b) => b.id - a.id)[0];
  const others = marked.filter((c) => c !== mine).map((c) => String(c.id));

  const done = (w: GhResult, action: "created" | "updated", superseded: string[]): Outcome => {
    try {
      const c = JSON.parse(w.stdout) as { id: number; html_url: string };
      return ok({ id: String(c.id), url: c.html_url, action, ...(superseded.length ? { superseded } : {}) });
    } catch {
      return bad(2, "NOT_FOUND", "gh api returned unreadable JSON", "check the issue comments on GitHub");
    }
  };
  const create = (superseded: string[]) => {
    const w = deps.gh(["api", "-X", "POST", `repos/${repo.repo}/issues/${ref.number}/comments`, "-f", `body=${body}`]);
    return w.code !== 0 ? ghFailure(w) : done(w, "created", superseded);
  };

  if (!mine) return create(others);
  const patch = deps.gh(["api", "-X", "PATCH", `repos/${repo.repo}/issues/comments/${mine.id}`, "-f", `body=${body}`]);
  if (patch.code === 0) return done(patch, "updated", []);
  // Edit refused (403) or comment gone (404): post a fresh marked comment instead.
  if (/HTTP 40[34]|forbidden|not found/i.test(patch.stderr)) return create([String(mine.id), ...others]);
  return ghFailure(patch);
}

/** Run one CLI invocation. Pure of process state: returns the exit code and what to print. */
export async function run(argv: string[], deps: Deps = defaultDeps): Promise<Outcome> {
  const p = parseArgs(argv);
  if (typeof p === "string") return usage(p);
  if (p.backend === "linear")
    return bad(4, "BACKEND", "the linear backend is not built", "Linear backend is task t1: the run asks the user which CLI to use");
  if (p.backend !== "gh") return usage(`unknown backend "${p.backend}"`);

  if (!(p.verb in FLAGS)) return usage(p.verb ? `unknown verb "${p.verb}"` : "a verb is required");
  const unknown = [...p.flags.keys()].filter((f) => f !== "--backend" && !FLAGS[p.verb].includes(f));
  if (unknown.length) return usage(`unknown flag ${unknown.join(", ")} for ${p.verb}; accepts ${FLAGS[p.verb].join(" ") || "no flags"}`);
  if (p.verb === "create") return create(p, deps);
  const ref = parseRef(p.positional[0]);
  if (!ref) return usage(`<ref> must be 12, #12 or an issue URL, got "${p.positional[0] ?? ""}"`);

  switch (p.verb) {
    case "view":
      return view(ref, deps);
    case "edit":
      return edit(ref, p, deps);
    case "comment":
      return comment(ref, p, deps);
    default:
      return upsertComment(ref, p, deps);
  }
}

if (import.meta.main) {
  const o = await run(process.argv.slice(2));
  if (o.err) console.error(JSON.stringify(o.err));
  else console.log(JSON.stringify(o.out));
  process.exit(o.code);
}
