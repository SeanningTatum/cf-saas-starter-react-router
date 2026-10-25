/**
 * Structural check for a feature decision record (docs/features/<slug>.md).
 *
 * The plan-feature workflow writes a record; this script says whether the record has the shape
 * ship-stack and the brain expect. It checks structure, not judgement: a record can pass and still
 * be a bad plan. The format is documented in docs/features/FORMAT.md.
 *
 *   bun run scripts/check-feature-doc.ts <file.md>
 *
 * Prints one JSON object { ok, file, failures: [{ rule, detail }] } to stdout.
 * Exit 0 when ok, 1 when any rule fails, 2 on usage or an unreadable file (error JSON on stderr).
 */
import { readFileSync } from "node:fs";

export interface Failure {
  rule: string;
  detail: string;
}

/** H2 headings, in the order the record must carry them. UX is skipped when `ui: false`. */
const SECTIONS = [
  "Summary",
  "Context",
  "User and job",
  "Fit",
  "Success metric",
  "Non-goals",
  "UX",
  "Architecture",
  "Decisions",
  "Flow",
  "PR stack",
  "Contract",
  "Open questions",
];

const MUST_HAVE_TEXT = ["Summary", "User and job", "Fit", "Success metric", "Architecture"];

const DIAGRAM_TYPES = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "stateDiagram-v2",
  "stateDiagram",
  "journey",
  "erDiagram",
  "gitGraph",
];

interface Parsed {
  front: Record<string, string> | null;
  /** Lines after the frontmatter. */
  body: string[];
}

function parseFrontmatter(markdown: string): Parsed {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { front: null, body: lines };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { front: null, body: lines };
  const front: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    // Drop a trailing ` # comment`, then surrounding quotes.
    const value = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    front[m[1]] = value;
  }
  return { front, body: lines.slice(end + 1) };
}

interface Section {
  name: string;
  lines: string[];
}

/** Split into H2 sections. A `## ` line inside a code fence is not a heading. */
function splitSections(body: string[]): Section[] {
  const out: Section[] = [];
  let fenced = false;
  let cur: Section | null = null;
  for (const line of body) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h = !fenced && /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = { name: h[1], lines: [] };
      out.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return out;
}

const hasText = (s: Section) => s.lines.some((l) => l.trim() !== "");

/** Bodies of ```mermaid fences in a section. */
function mermaidBlocks(s: Section): string[] {
  const blocks: string[] = [];
  let cur: string[] | null = null;
  for (const line of s.lines) {
    if (cur === null) {
      if (/^\s*```mermaid\s*$/.test(line)) cur = [];
    } else if (/^\s*```\s*$/.test(line)) {
      blocks.push(cur.join("\n"));
      cur = null;
    } else {
      cur.push(line);
    }
  }
  return blocks;
}

/** A syntax smell test: known diagram type on the first line, and balanced brackets. */
function mermaidProblem(code: string): string | null {
  const lines = code.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return "block is empty";
  const first = lines[0].trim().split(/\s+/)[0];
  if (!DIAGRAM_TYPES.includes(first)) return `unknown diagram type "${first}"`;
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  // Strip what may hold brackets legitimately: comments, quoted labels, ER cardinality ends.
  const bare = code
    .replace(/%%.*$/gm, "")
    .replace(/"[^"\n]*"/g, "")
    .replace(/[|}][o|]?(?=\s*(--|\.\.))|(?<=(--|\.\.)\s*)[o|]?[|{]/g, "");
  const stack: string[] = [];
  for (const ch of bare) {
    if ("([{".includes(ch)) stack.push(ch);
    else if (ch in pairs && stack.pop() !== pairs[ch]) return `unbalanced "${ch}"`;
  }
  return stack.length ? `unclosed "${stack[stack.length - 1]}"` : null;
}

/** Cells of the first markdown table in a section: header cells, then each data row's cells. */
function parseTable(s: Section): { header: string[]; rows: string[][] } | null {
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const start = s.lines.findIndex((l) => l.trim().startsWith("|"));
  if (start === -1) return null;
  const header = cells(s.lines[start]);
  const rows: string[][] = [];
  for (const l of s.lines.slice(start + 1)) {
    if (!l.trim().startsWith("|")) break;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
    rows.push(cells(l));
  }
  return { header, rows };
}

function checkDecisions(s: Section, fail: (rule: string, detail: string) => void) {
  const blocks: { title: string; lines: string[] }[] = [];
  for (const line of s.lines) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) blocks.push({ title: h[1], lines: [] });
    else blocks.at(-1)?.lines.push(line);
  }
  const decisions = blocks.filter((b) => /^D\d+ — /.test(b.title));
  if (decisions.length === 0) {
    fail("decisions", "no `### D<n> — <question>` heading");
    return;
  }
  for (const d of decisions) {
    const id = d.title.split(" ")[0];
    const field = (name: string) =>
      d.lines
        .map((l) => new RegExp(`^\\s*-\\s+\\*\\*${name}:\\*\\*\\s*(.*)$`).exec(l)?.[1]?.trim())
        .filter((v): v is string => v !== undefined);
    const area = field("Area")[0];
    if (!area || !["product", "ux", "backend"].includes(area))
      fail("decisions", `${id}: Area must be product, ux or backend`);
    if (!field("Chosen")[0]) fail("decisions", `${id}: Chosen is missing`);
    if (!field("Why")[0]) fail("decisions", `${id}: Why is missing`);
    const by = field("Decided by")[0];
    if (!by || !["user", "agent"].includes(by)) fail("decisions", `${id}: Decided by must be user or agent`);
    const rejected = field("Rejected");
    if (!rejected.some((r) => /\s—\s+\S/.test(r)))
      fail("decisions", `${id}: needs a Rejected line with a reason after " — "`);
  }
}

function checkPrototypes(s: Section, slug: string, fail: (rule: string, detail: string) => void) {
  const at = s.lines.findIndex((l) => /^###\s+Prototypes\s*$/.test(l));
  if (at === -1) {
    fail("prototypes", 'UX has no "### Prototypes" subsection');
    return;
  }
  // The subsection runs to the next heading.
  const rest = s.lines.slice(at + 1);
  const end = rest.findIndex((l) => /^#{2,3}\s/.test(l));
  const block = end === -1 ? rest : rest.slice(0, end);
  const items = block.filter((l) => /^\s*[-*]\s+/.test(l));
  if (items.length !== 3) fail("prototypes", `expected exactly 3 prototype lines, found ${items.length}`);
  const ids: string[] = [];
  for (const line of items) {
    const m = /^\s*[-*]\s+(\S+) [—-] (.+?) [—-] `(plans\/([^`/]+)-proto-([^`/]+)\.html)`\s*$/.exec(line);
    if (!m) {
      fail("prototypes", `line is not "- <id> — <name> — \`plans/…-proto-<id>.html\`": ${line.trim().slice(0, 60)}`);
      continue;
    }
    if (m[1] !== m[5]) fail("prototypes", `id "${m[1]}" does not match the file name's "-proto-${m[5]}.html"`);
    if (slug && m[4] !== slug) fail("prototypes", `file "${m[3]}" should be plans/${slug}-proto-${m[1]}.html (frontmatter slug)`);
    ids.push(m[1]);
  }
  if (ids.length === 3 && [...ids].sort().join(",") !== "a,b,c") fail("prototypes", `ids must be a, b, c; found ${ids.join(", ")}`);
  const chosen = block.map((l) => /^\s*Chosen:\s*(\S+)\s*$/.exec(l)?.[1]).find((v) => v);
  if (!chosen || !["a", "b", "c"].includes(chosen)) fail("prototypes", "needs a `Chosen: <id>` line naming a, b or c");
}

/** Normalise a fence path: drop leading ./, collapse //. Returns null for absolute paths or `..`. */
function normPath(p: string): string | null {
  const q = p.trim().replace(/\/+/g, "/").replace(/^(\.\/)+/, "");
  if (q.startsWith("/") || q.split("/").includes("..")) return null;
  return q;
}

/** True when one path equals the other or is a directory prefix of it. */
function overlaps(a: string, b: string): boolean {
  const dir = (p: string) => (p.endsWith("/") ? p : `${p}/`);
  return a === b || b.startsWith(dir(a)) || a.startsWith(dir(b));
}

function checkStack(s: Section, base: string, fail: (rule: string, detail: string) => void) {
  const table = parseTable(s);
  if (!table || table.rows.length === 0) {
    fail("stack", "PR stack has no rows");
    return;
  }
  const want = ["#", "Branch", "Base", "Fence", "Size", "Greptile focus"];
  if (table.header.length !== want.length || want.some((h, i) => table.header[i] !== h))
    fail("stack", `PR stack header must be exactly: ${want.join(" | ")}`);
  const seen = new Set<string>();
  const fences: { n: number; path: string }[] = [];
  table.rows.forEach((row, i) => {
    const n = i + 1;
    const [num, branch, rowBase, fence, size, focus] = row;
    if (!branch) fail("stack", `row ${n}: Branch is empty`);
    if (!focus) fail("stack", `row ${n}: Greptile focus is empty`);
    if (num !== String(n)) fail("stack", `row ${n}: # is "${num}", expected ${n}`);
    if (seen.has(branch)) fail("stack", `row ${n}: branch "${branch}" is repeated`);
    seen.add(branch);
    const wantBase = i === 0 ? base : table.rows[i - 1][1];
    if (rowBase !== wantBase) fail("stack", `row ${n}: base is "${rowBase}", expected "${wantBase}"`);
    const paths = [...(fence ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (paths.length === 0) fail("stack", `row ${n}: fence has no backticked path`);
    for (const raw of paths) {
      const path = normPath(raw);
      if (path === null) fail("stack", `row ${n}: fence path "${raw}" is absolute or contains ".."`);
      else fences.push({ n, path });
    }
    if (!["S", "M", "L"].includes(size)) fail("stack", `row ${n}: Size is "${size}", expected S, M or L`);
  });
  for (let i = 0; i < fences.length; i++)
    for (let j = i + 1; j < fences.length; j++)
      if (fences[i].n !== fences[j].n && overlaps(fences[i].path, fences[j].path))
        fail("fence-overlap", `PR ${fences[i].n} \`${fences[i].path}\` overlaps PR ${fences[j].n} \`${fences[j].path}\``);
}

export function checkFeatureDoc(markdown: string): Failure[] {
  const failures: Failure[] = [];
  const fail = (rule: string, detail: string) => failures.push({ rule, detail });
  const { front, body } = parseFrontmatter(markdown);

  // frontmatter
  if (!front) {
    fail("frontmatter", "no frontmatter block");
  } else {
    for (const k of ["slug", "title", "ticket", "date"])
      if (!front[k]) fail("frontmatter", `${k} is missing`);
    if (front.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(front.slug))
      fail("frontmatter", `slug "${front.slug}" is not kebab-case`);
    if (front.ticket && front.ticket !== "none" && !/^https?:\/\/\S+$/.test(front.ticket))
      fail("frontmatter", `ticket "${front.ticket}" is neither an http(s) URL nor "none"`);
  }
  const uiRequired = front?.ui?.toLowerCase() !== "false";

  // sections: presence and order
  const sections = splitSections(body);
  const wanted = SECTIONS.filter((n) => n !== "UX" || uiRequired);
  const byName = new Map<string, Section>();
  for (const s of sections) if (!byName.has(s.name)) byName.set(s.name, s);
  let lastIdx = -1;
  for (const name of wanted) {
    const idx = sections.findIndex((s) => s.name === name);
    if (idx === -1) fail("sections", `missing "## ${name}"`);
    else if (idx < lastIdx) fail("sections", `"## ${name}" is out of order`);
    else lastIdx = idx;
  }

  // empty-section
  for (const name of MUST_HAVE_TEXT) {
    const s = byName.get(name);
    if (s && !hasText(s)) fail("empty-section", `"## ${name}" has no text`);
  }

  // context-source
  for (const line of byName.get("Context")?.lines ?? []) {
    if (/^\s*[-*]\s+/.test(line) && !/ [—-] source: \S/.test(line))
      fail("context-source", `bullet has no " — source: " suffix: ${line.trim().slice(0, 60)}`);
  }

  // decisions
  const decisions = byName.get("Decisions");
  if (decisions) checkDecisions(decisions, fail);

  // mermaid
  for (const name of uiRequired ? ["UX", "Flow"] : ["Flow"]) {
    const s = byName.get(name);
    if (!s) continue;
    const blocks = mermaidBlocks(s);
    if (blocks.length === 0) fail("mermaid", `"## ${name}" has no mermaid block`);
    for (const b of blocks) {
      const problem = mermaidProblem(b);
      if (problem) fail("mermaid", `"## ${name}": ${problem}`);
    }
  }

  // ux-states
  const ux = uiRequired ? byName.get("UX") : undefined;
  if (ux) {
    const table = parseTable(ux);
    const header = (table?.header ?? []).map((h) => h.toLowerCase());
    const absent = ["empty", "loading", "error", "success"].filter((c) => !header.includes(c));
    if (!table) fail("ux-states", "UX has no state table");
    else if (absent.length) fail("ux-states", `state table lacks: ${absent.join(", ")}`);
  }

  // prototypes: three rival directions and the pick, inside UX
  if (ux) checkPrototypes(ux, front?.slug ?? "", fail);

  // stack + fence-overlap
  const stack = byName.get("PR stack");
  if (stack) checkStack(stack, front?.base || "main", fail);

  return failures;
}

function main(argv: string[]): number {
  const file = argv[0];
  if (!file || argv.length > 1) {
    console.error(JSON.stringify({ error: "usage: check-feature-doc.ts <file.md>", code: "USAGE" }));
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    console.error(JSON.stringify({ error: `cannot read ${file}: ${(e as Error).message}`, code: "UNREADABLE" }));
    return 2;
  }
  const failures = checkFeatureDoc(text);
  console.log(JSON.stringify({ ok: failures.length === 0, file, failures }));
  return failures.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
