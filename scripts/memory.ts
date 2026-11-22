/**
 * Working memory per feature: the script merges, no model edits the store.
 *
 *   bun scripts/memory.ts record <slug>          fields on stdin, one "key: value" per line
 *   bun scripts/memory.ts recall <slug|status>   prints the brief; read-only
 *
 * Keys for `record` (a key may repeat; an unknown key, a bad status or slug, or no field at all
 * exits 2 and writes nothing):
 *   status    planned | in-progress | blocked | done | dropped. A new file with none is in-progress.
 *   issue     #12 or a URL (a bare number becomes #12).
 *   context   the Context section. Written only when that section is empty or still the template.
 *   log       what happened, one line. With stopped, waiting, next it makes ONE Log entry at the top.
 *   decision  "<decision> — <why> — <source>". Stored with today's date; the same text is not added twice.
 *   link      "<label>: <url or #n>". Exact duplicates are dropped.
 *   todo      adds "- [ ] <item>" unless the item is there already, open or ticked.
 *   done      ticks the matching open todo (case and outer spaces ignored), else adds it ticked.
 * The script stamps the date itself.
 *
 * The store (`./scripts/memory-dir.sh` prints it; CONTEXT_MEMORY_DIR moves it):
 *   <dir>/INDEX.md    one line per feature, sorted in-progress, blocked, planned, then done and dropped:
 *                     - [<slug>](<slug>.md) — <status> — <issue or none> — <where it stands>
 *   <dir>/_general.md decisions, links and todos that span features (same sections as a feature file)
 *   <dir>/<slug>.md   one file per feature, slugs in kebab-case:
 *
 *     ---
 *     feature: <slug>
 *     status: planned | in-progress | blocked | done | dropped
 *     issue: <#n or URL, or none>
 *     updated: <YYYY-MM-DD>
 *     ---
 *
 *     ## Context        what it is, who it is for, why now: three to six lines
 *     ## Decisions      - YYYY-MM-DD — <decision> — <why> — <source>
 *     ## Links          - <label>: <URL or #n>
 *     ## Todo           - [ ] <item>   or   - [x] <item> (YYYY-MM-DD)
 *     ## Log            newest first: - YYYY-MM-DD — <what happened> — stopped at: <..> — waiting for: <..> — next: <..>
 *
 * Merge rules: ticked todos older than 30 days go; the newest ten Log entries stay and older ones fold
 * into one `- earlier: ...` line; a file over 150 lines is still written, and the output says so (a
 * model then shortens Context and the earlier log). The script also owns one line of Claude Code's
 * MEMORY.md (`./scripts/memory-dir.sh --index`) and touches no other line there.
 *
 * Files written by hand, or by the old context-memory agent, merge cleanly: sections may come in any
 * order or be missing, extra sections and unknown front matter stay as they were, and a line the script
 * does not understand is kept where it is.
 *
 * Disk, the store's paths and the date sit behind `Deps`, so the tests touch no real store. Exit codes:
 * 0 ok, 1 the store could not be reached, 2 bad input.
 *
 * CONTEXT_MEMORY_INDEX and CONTEXT_MEMORY_LINK move the MEMORY.md path and link: CONTEXT_MEMORY_DIR alone
 * leaves them on the real MEMORY.md, so a hand run that sets only the directory would rewrite its real line.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATUSES = ["planned", "in-progress", "blocked", "done", "dropped"] as const;
const KEYS = ["status", "issue", "context", "log", "stopped", "waiting", "next", "decision", "link", "todo", "done"] as const;
type Key = (typeof KEYS)[number];
type Fields = Partial<Record<Key, string[]>>;

const SLUG = /^(_general|[a-z0-9]+(-[a-z0-9]+)*)$/;
const TEMPLATE_CONTEXT = "What it is, who it is for, why now. Three to six lines.";
const MAX_LINES = 150;
const KEEP_LOG = 10;
const TODO_DAYS = 30;
const SECTIONS = ["Context", "Decisions", "Links", "Todo", "Log"] as const;

export interface Deps {
  /** The store directory (created if missing). */
  dir: () => string;
  /** Path of Claude Code's MEMORY.md, and the link its one line carries. */
  memoryIndex: () => string;
  memoryLink: () => string;
  /** File text, or null when the file is missing. */
  read: (path: string) => string | null;
  write: (path: string, text: string) => void;
  /** File names in a directory. */
  list: (dir: string) => string[];
  /** Today as YYYY-MM-DD. */
  today: () => string;
}

interface Outcome {
  code: number;
  out?: string;
  err?: string;
}

const ok = (out: string): Outcome => ({ code: 0, out });
const bad = (err: string): Outcome => ({ code: 2, err: `memory: ${err}` });

// ---- Input ----------------------------------------------------------------------------------------

/** Reads `key: value` lines. Empty values are skipped; an unknown key, bad status or bad issue is an error. */
export function parseFields(stdin: string): { fields: Fields } | { error: string } {
  const fields: Fields = {};
  for (const raw of stdin.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = /^\s*([A-Za-z_-]+)\s*:\s?(.*)$/.exec(raw);
    if (!m) return { error: `not a "key: value" line: ${raw.trim().slice(0, 60)}` };
    const key = m[1].toLowerCase() as Key;
    if (!KEYS.includes(key)) return { error: `unknown key "${m[1]}" (keys: ${KEYS.join(", ")})` };
    const value = m[2].trim();
    if (!value) continue;
    (fields[key] ??= []).push(value);
  }
  const status = fields.status?.at(-1);
  if (status !== undefined && !(STATUSES as readonly string[]).includes(status))
    return { error: `bad status "${status}" (one of: ${STATUSES.join(", ")})` };
  if (fields.issue) {
    const issue = fields.issue.at(-1)!;
    if (/^\d+$/.test(issue)) fields.issue = [`#${issue}`];
    else if (!/^(#\d+|none|https?:\/\/\S+)$/.test(issue)) return { error: `bad issue "${issue}" (#12 or a URL)` };
  }
  if (!Object.keys(fields).length) return { error: "no fields on stdin" };
  return { fields };
}

// ---- The feature file -----------------------------------------------------------------------------

interface Section {
  /** Lower-case name, for matching. */
  name: string;
  heading: string;
  body: string[];
}
interface Doc {
  /** Raw front matter lines, without the `---` fences. */
  fm: string[];
  /** Text between the front matter and the first heading. */
  preamble: string[];
  sections: Section[];
}

const blank = (l: string) => !l.trim();
function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && blank(lines[a])) a++;
  while (b > a && blank(lines[b - 1])) b--;
  return lines.slice(a, b);
}

function parseDoc(text: string): Doc {
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  let fm: string[] = [];
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (end > 0) {
      fm = lines.slice(1, end);
      i = end + 1;
    }
  }
  const preamble: string[] = [];
  const sections: Section[] = [];
  for (; i < lines.length; i++) {
    const h = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (h) sections.push({ name: h[1].toLowerCase(), heading: lines[i].trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(lines[i]);
    else preamble.push(lines[i]);
  }
  for (const s of sections) s.body = trimBlank(s.body);
  return { fm, preamble: trimBlank(preamble), sections };
}

function renderDoc(d: Doc): string {
  const parts: string[] = [`---\n${d.fm.join("\n")}\n---`];
  if (d.preamble.length) parts.push(d.preamble.join("\n"));
  for (const s of d.sections) parts.push([s.heading, ...s.body].join("\n"));
  return `${parts.join("\n\n")}\n`;
}

function newDoc(slug: string): Doc {
  return {
    fm: [`feature: ${slug}`, "status: in-progress", "issue: none", "updated:"],
    preamble: [],
    sections: SECTIONS.map((n) => ({ name: n.toLowerCase(), heading: `## ${n}`, body: n === "Context" ? [TEMPLATE_CONTEXT] : [] })),
  };
}

/** Index of a front matter key: a top-level one first, else one indented under a parent (`metadata:`). */
function fmAt(d: Doc, key: string): number {
  const top = d.fm.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  return top >= 0 ? top : d.fm.findIndex((l) => new RegExp(`^\\s+${key}\\s*:`).test(l));
}
function getFm(d: Doc, key: string): string | undefined {
  const at = fmAt(d, key);
  return at < 0 ? undefined : d.fm[at].slice(d.fm[at].indexOf(":") + 1).trim();
}
function setFm(d: Doc, key: string, value: string) {
  const at = fmAt(d, key);
  if (at >= 0) d.fm[at] = `${d.fm[at].match(/^\s*/)![0]}${key}: ${value}`;
  else d.fm.push(`${key}: ${value}`);
}

/** The first section with this name; a missing one is created in canonical place. */
function section(d: Doc, name: (typeof SECTIONS)[number]): Section {
  const lower = name.toLowerCase();
  const found = d.sections.find((s) => s.name === lower);
  if (found) return found;
  const made: Section = { name: lower, heading: `## ${name}`, body: [] };
  const want = SECTIONS.indexOf(name);
  const later = d.sections.findIndex((s) => {
    const r = SECTIONS.findIndex((n) => n.toLowerCase() === s.name);
    return r > want;
  });
  if (later >= 0) d.sections.splice(later, 0, made);
  else d.sections.push(made);
  return made;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const DATE = /\d{4}-\d{2}-\d{2}/;

/** A decision's text with its date and any `(superseded ...)` mark taken off, for comparing. */
function decisionKey(line: string): string {
  return norm(
    line
      .replace(/^\s*-\s*/, "")
      .replace(new RegExp(`^${DATE.source}\\s*[—-]\\s*`), "")
      .replace(/\(superseded[^)]*\)/g, ""),
  );
}

interface Todo {
  at: number;
  ticked: boolean;
  text: string;
  date?: string;
}
const TODO_LINE = /^(\s*)- \[( |x|X)\]\s?(.*)$/;
function todoKey(text: string): string {
  return norm(text.replace(new RegExp(`\\(${DATE.source}\\)\\s*$`), ""));
}
function readTodos(body: string[]): Todo[] {
  const out: Todo[] = [];
  body.forEach((l, at) => {
    const m = TODO_LINE.exec(l);
    if (!m) return;
    const date = new RegExp(`\\((${DATE.source})\\)\\s*$`).exec(m[3])?.[1];
    out.push({ at, ticked: m[2] !== " ", text: m[3].trim().replace(new RegExp(`\\s*\\(${DATE.source}\\)\\s*$`), ""), date });
  });
  return out;
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Entries of a Log body: a line starting `- ` opens one, other lines belong to the entry above. */
function readLog(body: string[]): { head: string[]; entries: string[][] } {
  const head: string[] = [];
  const entries: string[][] = [];
  for (const l of body) {
    if (/^-\s/.test(l)) entries.push([l]);
    else if (entries.length) entries[entries.length - 1].push(l);
    else head.push(l);
  }
  return { head, entries };
}
/** One folded entry: its date and its first clause. */
function foldedForm(entry: string[]): string {
  const [date, what] = entry[0].replace(/^-\s*/, "").split(" — ");
  return [date, what].filter(Boolean).join(" ").trim();
}

/** Drops old ticked todos, adds new ones, ticks done ones. Returns the counts. */
function mergeTodos(todo: Section, fields: Fields, today: string): { todos: number; ticked: number; pruned: number } {
  const n = { todos: 0, ticked: 0, pruned: 0 };
  // Old ticked items go first, so a todo the user re-adds is not blocked by a ghost.
  const drop = new Set<number>();
  for (const t of readTodos(todo.body))
    if (t.ticked && t.date && (dayMs(today) - dayMs(t.date)) / 86_400_000 > TODO_DAYS) drop.add(t.at);
  if (drop.size) {
    todo.body = todo.body.filter((_, at) => !drop.has(at));
    n.pruned = drop.size;
  }
  for (const v of fields.todo ?? []) {
    if (readTodos(todo.body).some((t) => todoKey(t.text) === todoKey(v))) continue;
    todo.body.push(`- [ ] ${v}`);
    n.todos++;
  }
  for (const v of fields.done ?? []) {
    const have = readTodos(todo.body).filter((t) => todoKey(t.text) === todoKey(v));
    const open = have.find((t) => !t.ticked);
    if (open) {
      todo.body[open.at] = `- [x] ${open.text} (${today})`;
      n.ticked++;
    } else if (!have.length) {
      todo.body.push(`- [x] ${v} (${today})`);
      n.ticked++;
    }
  }
  return n;
}

/** Puts one entry (text after the "- ") at the top of Log, keeps the newest ten, folds the rest. Returns how many it folded. */
function mergeLog(log: Section, entry: string): number {
  const { head, entries } = readLog(log.body);
  const earlierAt = entries.findIndex((e) => /^-\s*earlier:/i.test(e[0]));
  const earlier = earlierAt >= 0 ? entries.splice(earlierAt, 1)[0] : null;
  entries.unshift([`- ${entry}`]);
  const keep = entries.slice(0, KEEP_LOG);
  const folded = entries.slice(KEEP_LOG);
  const out = [...head, ...keep.flat()];
  if (folded.length || earlier) {
    const old = earlier ? earlier.join(" ").replace(/^-\s*earlier:\s*/i, "") : "";
    out.push(`- earlier: ${[...folded.map(foldedForm), old].filter(Boolean).join("; ")}`);
  }
  log.body = out;
  return folded.length;
}

interface Merge {
  text: string;
  slug: string;
  status: string;
  issue: string;
  /** The INDEX.md "where it stands" for this feature, or undefined to keep the old one. */
  blurb?: string;
  /** What the record said comes next. */
  next?: string;
  summary: string[];
  lines: number;
  tooLong: boolean;
}

/** Merges `fields` into the file's text (null for a new file). Pure. */
export function mergeRecord(existing: string | null, slug: string, fields: Fields, today: string): Merge {
  const d = existing === null ? newDoc(slug) : parseDoc(existing);
  const isNew = existing === null;
  if (getFm(d, "feature") === undefined) d.fm.unshift(`feature: ${slug}`);
  if (getFm(d, "status") === undefined) d.fm.push("status: in-progress");
  const was = getFm(d, "status")!;
  const status = fields.status?.at(-1) ?? was;
  setFm(d, "status", status);
  const wasIssue = getFm(d, "issue");
  const issue = fields.issue?.at(-1) ?? wasIssue ?? "none";
  setFm(d, "issue", issue);
  setFm(d, "updated", today);

  const n = { decisions: 0, links: 0, todos: 0, ticked: 0, pruned: 0, folded: 0 };

  let context = "untouched";
  if (fields.context) {
    const s = section(d, "Context");
    const text = s.body.join("\n").trim();
    if (!text || text === TEMPLATE_CONTEXT) {
      s.body = fields.context;
      context = "written";
    } else context = "kept (already written)";
  }

  const decisions = section(d, "Decisions");
  for (const v of fields.decision ?? []) {
    const key = norm(v);
    if (decisions.body.some((l) => /^\s*-\s/.test(l) && decisionKey(l) === key)) continue;
    decisions.body.push(`- ${today} — ${v}`);
    n.decisions++;
  }

  const links = section(d, "Links");
  for (const v of fields.link ?? []) {
    if (links.body.some((l) => l.trim() === `- ${v}`)) continue;
    links.body.push(`- ${v}`);
    n.links++;
  }

  if (fields.todo || fields.done || d.sections.some((s) => s.name === "todo")) {
    Object.assign(n, mergeTodos(section(d, "Todo"), fields, today));
  }

  const one = (k: Key) => fields[k]?.join("; ");
  const entryParts = [
    ...(fields.log ? [fields.log.join("; ")] : []),
    ...(one("stopped") ? [`stopped at: ${one("stopped")}`] : []),
    ...(one("waiting") ? [`waiting for: ${one("waiting")}`] : []),
    ...(one("next") ? [`next: ${one("next")}`] : []),
  ];
  let logLine = "no new entry";
  if (entryParts.length) {
    n.folded = mergeLog(section(d, "Log"), [today, ...entryParts].join(" — "));
    logLine = n.folded ? `new entry at the top, ${n.folded} folded into earlier` : "new entry at the top";
  }

  const text = renderDoc(d);
  const lines = text.trimEnd().split("\n").length;
  const statusNote = isNew ? `status ${status}` : status === was ? `status ${status} (unchanged)` : `status ${was} -> ${status}`;
  const issueNote = issue === (wasIssue ?? "none") && !isNew ? "" : `, issue ${issue}`;
  const summary = [
    `${isNew ? "created" : "merged"} ${slug}: ${statusNote}${issueNote}`,
    `added ${n.decisions} decision(s), ${n.links} link(s), ${n.todos} todo(s); ticked ${n.ticked}; dropped ${n.pruned} old ticked; context ${context}`,
    `log: ${logLine}; file is ${lines} lines`,
  ];
  const blurb = fields.log?.[0] ?? (one("stopped") ? one("stopped") : one("next"));
  return { text, slug, status, issue, blurb, next: one("next"), summary, lines, tooLong: lines > MAX_LINES };
}

// ---- INDEX.md and MEMORY.md -----------------------------------------------------------------------

const FEATURE_LINE = /^- \[([^\]]+)\]\(([^)]*)\)/;
const rank = (status: string) => ({ "in-progress": 0, blocked: 1, planned: 2, done: 3, dropped: 3 })[status as "done"] ?? 4;

interface IndexLine {
  slug: string;
  status: string;
  issue: string;
  blurb: string;
  raw: string;
}
function parseIndex(text: string | null): { head: string[]; lines: IndexLine[]; tail: string[] } {
  const head: string[] = [];
  const lines: IndexLine[] = [];
  const tail: string[] = [];
  for (const raw of (text ?? "").replace(/\r/g, "").split("\n")) {
    const m = FEATURE_LINE.exec(raw);
    if (m) {
      const [status = "", issue = "", ...rest] = raw.slice(m[0].length).replace(/^\s*—\s*/, "").split(" — ");
      lines.push({ slug: m[1], status: status.trim(), issue: issue.trim(), blurb: rest.join(" — ").trim(), raw });
    } else if (lines.length) {
      if (raw.trim()) tail.push(raw);
    } else head.push(raw);
  }
  return { head, lines, tail };
}

/** Puts this feature's line in INDEX.md (keeping its old blurb when `blurb` is undefined) and sorts. */
export function updateIndex(text: string | null, m: { slug: string; status: string; issue: string; blurb?: string }): string {
  const { head, lines, tail } = parseIndex(text);
  const old = lines.find((l) => l.slug === m.slug);
  const blurb = m.blurb ?? old?.blurb ?? "none";
  const line = `- [${m.slug}](${m.slug}.md) — ${m.status} — ${m.issue} — ${blurb}`;
  const next = lines.filter((l) => l.slug !== m.slug);
  const at = old ? lines.indexOf(old) : lines.length;
  next.splice(Math.min(at, next.length), 0, { slug: m.slug, status: m.status, issue: m.issue, blurb, raw: line });
  next.sort((a, b) => rank(a.status) - rank(b.status));
  const top = trimBlank(head);
  if (!top.length) top.push("# Features");
  return `${[...top, "", ...next.map((l) => l.raw), ...tail].join("\n")}\n`;
}

const MEMORY_LINE = "- [Feature memory](";

/** Replaces the one Feature memory line in MEMORY.md, or adds it; every other line stays. */
function updateMemoryLine(text: string | null, link: string, indexText: string, record: { slug: string; next?: string }): string {
  const { lines } = parseIndex(indexText);
  const active = lines.filter((l) => l.status === "in-progress");
  const mine = active.find((l) => l.slug === record.slug);
  const next = (mine && record.next) || active[0]?.blurb || "none";
  const line = `${MEMORY_LINE}${link}) — active: ${active.length ? active.map((l) => l.slug).join(", ") : "none"} — next: ${next}`;
  const rows = (text ?? "").split("\n");
  if (rows.at(-1) === "") rows.pop();
  const at = rows.findIndex((l) => l.startsWith(MEMORY_LINE));
  if (at >= 0) rows[at] = line;
  else rows.push(line);
  return `${rows.join("\n")}\n`;
}

// ---- recall ---------------------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
/** Up to three stored slugs nearest to `slug`: a shared word or a small edit distance. */
export function closestSlugs(slug: string, all: string[]): string[] {
  const words = slug.split("-").filter((w) => w.length > 2);
  return all
    .map((s) => ({ s, d: levenshtein(slug, s), shared: words.some((w) => s.includes(w)) }))
    .filter((x) => x.shared || x.d < 4)
    .sort((a, b) => Number(b.shared) - Number(a.shared) || a.d - b.d || a.s.localeCompare(b.s))
    .slice(0, 3)
    .map((x) => x.s);
}

function newestLog(text: string): string | null {
  const log = parseDoc(text).sections.find((s) => s.name === "log");
  return log ? (readLog(log.body).entries[0]?.[0] ?? null) : null;
}

function brief(text: string, slug: string): string {
  const d = parseDoc(text);
  const get = (n: string) => d.sections.find((s) => s.name === n)?.body ?? [];
  const list = (ls: string[]) => (ls.length ? ls.join("\n") : "none");
  const context = get("context").filter((l) => !blank(l) && l.trim() !== TEMPLATE_CONTEXT).slice(0, 4);
  const decisions = get("decisions").filter((l) => !/\(superseded/.test(l));
  const open = get("todo").filter((l) => TODO_LINE.exec(l)?.[2] === " ");
  return [
    `Feature: ${getFm(d, "feature") ?? slug} — ${getFm(d, "status") ?? "unknown"} — ${getFm(d, "issue") ?? "none"}`,
    `Context: ${context.length ? context.join(" ") : "none"}`,
    `Decisions:\n${list(decisions)}`,
    `Open todos:\n${list(open)}`,
    `Links:\n${list(get("links"))}`,
    `Last log: ${readLog(get("log")).entries[0]?.[0].replace(/^-\s*/, "") ?? "none"}`,
  ].join("\n");
}

function recall(what: string, deps: Deps): Outcome {
  const dir = deps.dir();
  const indexText = deps.read(join(dir, "INDEX.md"));
  if (what === "status") {
    const live = parseIndex(indexText).lines.filter((l) => l.status === "in-progress" || l.status === "blocked");
    if (!live.length) return ok("no in-progress or blocked features");
    return ok(
      live
        .map((l) => {
          const file = deps.read(join(dir, `${l.slug}.md`));
          return `${l.raw}\n  newest log: ${(file && newestLog(file)) ?? "none"}`;
        })
        .join("\n"),
    );
  }
  const slug = what.replace(/^#/, "");
  if (!SLUG.test(slug)) return bad(`"${what}" is not a kebab-case slug, an issue number, or "status"`);
  let file = deps.read(join(dir, `${slug}.md`));
  let found = slug;
  if (file === null && /^\d+$/.test(slug)) {
    const byIssue = parseIndex(indexText).lines.find((l) => l.issue === `#${slug}` || l.issue.endsWith(`/${slug}`));
    if (byIssue) {
      found = byIssue.slug;
      file = deps.read(join(dir, `${found}.md`));
    }
  }
  if (file === null) {
    const slugs = deps.list(dir).filter((f) => f.endsWith(".md") && f !== "INDEX.md").map((f) => f.slice(0, -3));
    const near = closestSlugs(slug, slugs);
    return ok(`nothing recorded for ${what}${near.length ? `\nclosest slugs: ${near.join(", ")}` : ""}`);
  }
  return ok(brief(file, found));
}

// ---- record ---------------------------------------------------------------------------------------

function record(slug: string, stdin: string, deps: Deps): Outcome {
  if (!SLUG.test(slug)) return bad(`"${slug}" is not a kebab-case slug`);
  const parsed = parseFields(stdin);
  if ("error" in parsed) return bad(parsed.error);
  const dir = deps.dir();
  const path = join(dir, `${slug}.md`);
  const merged = mergeRecord(deps.read(path), slug, parsed.fields, deps.today());
  deps.write(path, merged.text);

  const indexPath = join(dir, "INDEX.md");
  const indexText = updateIndex(deps.read(indexPath), merged);
  deps.write(indexPath, indexText);

  const memPath = deps.memoryIndex();
  deps.write(memPath, updateMemoryLine(deps.read(memPath), deps.memoryLink(), indexText, merged));

  const extra = merged.tooLong ? [`over ${MAX_LINES} lines: ask context-memory to shorten Context and the earlier log`] : [];
  return ok([path, ...merged.summary, ...extra].join("\n"));
}

export function run(argv: string[], stdin: string, deps: Deps): Outcome {
  const [verb, arg, ...rest] = argv;
  const usage = "usage: bun scripts/memory.ts record <slug> (fields on stdin) | recall <slug|status>";
  if (!arg || rest.length) return bad(usage);
  if (verb === "record") return record(arg, stdin, deps);
  if (verb === "recall") return recall(arg, deps);
  return bad(usage);
}

// ---- Real disk ------------------------------------------------------------------------------------

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "memory-dir.sh");
function viaScript(flag?: string): string {
  const r = spawnSync(SCRIPT, flag ? [flag] : [], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`memory-dir.sh failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

const defaultDeps: Deps = {
  dir: () => {
    const dir = process.env.CONTEXT_MEMORY_DIR || viaScript();
    mkdirSync(dir, { recursive: true });
    return dir;
  },
  memoryIndex: () => process.env.CONTEXT_MEMORY_INDEX || viaScript("--index"),
  memoryLink: () => process.env.CONTEXT_MEMORY_LINK || viaScript("--link"),
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  write: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  },
  list: (dir) => readdirSync(dir),
  today: () => new Date().toLocaleDateString("en-CA"),
};

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let o: Outcome;
  try {
    o = run(argv, argv[0] === "record" ? await Bun.stdin.text() : "", defaultDeps);
  } catch (e) {
    o = { code: 1, err: `memory: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (o.out !== undefined) console.log(o.out);
  if (o.err !== undefined) console.error(o.err);
  process.exit(o.code);
}
