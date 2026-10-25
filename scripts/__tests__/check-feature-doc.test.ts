import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFeatureDoc } from "../check-feature-doc";

const dir = join(__dirname, "fixtures", "feature-doc");
const load = (name: string) => readFileSync(join(dir, `${name}.md`), "utf8");

const RULES = [
  "frontmatter",
  "sections",
  "empty-section",
  "context-source",
  "decisions",
  "mermaid",
  "ux-states",
  "stack",
  "fence-overlap",
  "prototypes",
];

describe("checkFeatureDoc fixtures", () => {
  it("a complete record passes: a checker that rejects good input blocks every plan", () => {
    expect(checkFeatureDoc(load("good"))).toEqual([]);
  });

  for (const rule of RULES) {
    it(`${rule}.md fails on "${rule}" and on nothing else: a rule that also fires on other breakage hides which one the author fixed`, () => {
      const rules = new Set(checkFeatureDoc(load(rule)).map((f) => f.rule));
      expect([...rules]).toEqual([rule]);
    });
  }
});

describe("checkFeatureDoc edge cases", () => {
  const good = load("good");

  it("a record with no frontmatter fails 'frontmatter' rather than crashing", () => {
    const body = good.replace(/^---[\s\S]*?---\n/, "");
    expect(checkFeatureDoc(body).map((f) => f.rule)).toContain("frontmatter");
  });

  it("ticket: none is accepted: tickets are optional for an idea-only run", () => {
    const doc = good.replace(/ticket: .*/, "ticket: none");
    expect(checkFeatureDoc(doc)).toEqual([]);
  });

  it("ticket that is a bare word fails: a dead link would reach the issue comment", () => {
    const doc = good.replace(/ticket: .*/, "ticket: soon");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["frontmatter"]);
  });

  it("ui: false drops the UX section and its mermaid and state-table checks", () => {
    const doc = good.replace("ui: true", "ui: false").replace(/## UX[\s\S]*?(?=## Architecture)/, "");
    expect(checkFeatureDoc(doc)).toEqual([]);
  });

  it("ui: false needs no Prototypes: a backend-only record must not be forced to invent directions", () => {
    const doc = good.replace("ui: true", "ui: false").replace(/## UX[\s\S]*?(?=## Architecture)/, "");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).not.toContain("prototypes");
  });

  it("only two prototype lines fail 'prototypes': the review needs three rival directions", () => {
    const doc = good.replace(/- c — Single.*\n/, "");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["prototypes"]);
  });

  it("a hyphen separator is accepted in prototype lines, like context-source", () => {
    const doc = good.replace("a — Table with inline revoke — `", "a - Table with inline revoke - `");
    expect(checkFeatureDoc(doc)).toEqual([]);
  });

  it("an id that disagrees with its file name fails: the pick would open the wrong prototype", () => {
    const doc = good.replace("proto-b.html", "proto-c.html");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["prototypes"]);
  });

  it("prototype files must carry the record's slug: a copied record would point at another feature's pages", () => {
    const doc = good.replaceAll("plans/team-invites-proto-", "plans/other-proto-");
    expect([...new Set(checkFeatureDoc(doc).map((f) => f.rule))]).toEqual(["prototypes"]);
  });

  it("./app/x and app/x overlap across PRs: un-normalised paths hid shared files", () => {
    const doc = good.replace("`app/trpc/routes/invites.ts`", "`./app/db/schema.ts`");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["fence-overlap"]);
  });

  it("a double slash does not hide an overlap", () => {
    const doc = good.replace("`app/trpc/routes/invites.ts`", "`app//db/schema.ts`");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["fence-overlap"]);
  });

  it("a '..' or absolute fence path fails 'stack': it would escape the repo", () => {
    expect(checkFeatureDoc(good.replace("`app/trpc/routes/invites.ts`", "`../x.ts`")).map((f) => f.rule)).toEqual(["stack"]);
    expect(checkFeatureDoc(good.replace("`app/trpc/routes/invites.ts`", "`/etc/x`")).map((f) => f.rule)).toEqual(["stack"]);
  });

  const withFlow = (diagram: string) => good.replace(/```mermaid\nflowchart TD\n  P1[\s\S]*?```/, "```mermaid\n" + diagram + "\n```");

  it("an erDiagram cardinality like ||--o{ passes: its { is not an open bracket", () => {
    expect(checkFeatureDoc(withFlow("erDiagram\n  TEAM ||--o{ MEMBER : has\n  A }|..|{ B : uses"))).toEqual([]);
  });

  it("brackets inside quoted labels and %% comments are ignored", () => {
    expect(checkFeatureDoc(withFlow('flowchart TD\n  A["label (with ) paren"] --> B\n  %% a ( comment'))).toEqual([]);
  });

  it("a genuinely unclosed bracket still fails after the stripping", () => {
    expect(checkFeatureDoc(withFlow("flowchart TD\n  A[label --> B")).map((f) => f.rule)).toEqual(["mermaid"]);
  });

  it("an empty Branch cell fails 'stack': ship-stack could not open that PR", () => {
    const doc = good.replace("| 3 | feat/team-invites/3-ui |", "| 3 |  |");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toContain("stack");
  });

  it("an empty Greptile focus cell fails 'stack'", () => {
    const doc = good.replace("| State coverage, i18n keys |", "|  |");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["stack"]);
  });

  it("a PR stack table without the Greptile focus column fails 'stack'", () => {
    const doc = good.replace("| Size | Greptile focus |", "| Size |").replace(/\| (S|M|L) \| [^|\n]+ \|\n/g, "| $1 |\n").replace("|------|----------------|", "|------|");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toContain("stack");
  });

  it("a missing Prototypes subsection fails on a ui record", () => {
    const doc = good.replace(/### Prototypes[\s\S]*?Chosen: a\n/, "");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["prototypes"]);
  });

  it("sections out of order fail: ship-stack reads the record top to bottom", () => {
    const doc = good.replace("## Fit", "## Tmp").replace("## Success metric", "## Fit").replace("## Tmp", "## Success metric");
    const f = checkFeatureDoc(doc);
    expect(f.some((x) => x.rule === "sections" && x.detail.includes("out of order"))).toBe(true);
  });

  it("a '## ' line inside a code fence is not a heading: Contract code may hold comments", () => {
    const doc = good.replace("// invites.list() -> Invite[]", "## not a heading\n// invites.list() -> Invite[]");
    expect(checkFeatureDoc(doc)).toEqual([]);
  });

  it("a hyphen before 'source:' is accepted for Context bullets: editors turn em dashes into hyphens", () => {
    const doc = good.replace("schema.ts", "schema.ts").replace(" — source: app/db/schema.ts", " - source: app/db/schema.ts");
    expect(checkFeatureDoc(doc)).toEqual([]);
  });

  it("a decision without 'Decided by' fails: the human must see which calls they never made", () => {
    const doc = good.replace("- **Decided by:** user\n", "");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["decisions"]);
  });

  it("a PR whose base is not the previous branch fails 'stack': the stack would not merge in order", () => {
    const doc = good.replace("| feat/team-invites/2-api | feat/team-invites/1-data |", "| feat/team-invites/2-api | main |");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["stack"]);
  });

  it("PR 1 base must match frontmatter base: a record for a release branch must not target main", () => {
    const doc = good.replace("base: main", "base: develop");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["stack"]);
  });

  it("a mermaid block with an unknown diagram type fails: the page would render as raw text", () => {
    const doc = good.replace("flowchart TD\n  P1", "flowchar TD\n  P1");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["mermaid"]);
  });

  it("an empty mermaid block fails: an empty fence passes a presence-only check", () => {
    const doc = good.replace(/```mermaid\nflowchart TD\n  P1[\s\S]*?```/, "```mermaid\n```");
    expect(checkFeatureDoc(doc).map((f) => f.rule)).toEqual(["mermaid"]);
  });

  it("sibling directories with a shared name prefix do not overlap: 'app/routes' is not a prefix of 'app/routes-extra/x'", () => {
    const doc = good.replace("`app/routes/team/`", "`app/routes-extra/team/`").replace("`app/trpc/routes/invites.ts`", "`app/routes/`");
    expect(checkFeatureDoc(doc)).toEqual([]);
  });
});
