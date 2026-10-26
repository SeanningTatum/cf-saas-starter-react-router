# Feature decision record

`/plan-feature` writes one record per feature. During planning it lives at `.verify/<slug>/record.md` (git ignores it);
`ship-feature` commits it as `docs/features/<slug>.md` in PR 1. `bun run feature-doc:check <file>` checks it.

The record is a plan's audit trail: what we found, what we chose, what we rejected and who chose it.

## Shape

Frontmatter, then these H2 sections in this order:

1. `Summary`, `Context`, `User and job`, `Fit`, `Success metric`, `Non-goals`
2. `UX` (skipped when frontmatter says `ui: false`)
3. `Architecture`, `Decisions`, `Flow`, `PR stack`, `Contract`, `Open questions`

Frontmatter keys: `slug` (kebab-case), `title`, `ticket` (an http(s) URL or `none`), `date`, `ui`
(`false` skips UX), `base` (the branch PR 1 targets; default `main`).

Each Context bullet ends with ` — source: <ref>`. Each decision is a `### D<n> — <question>` block with
`Area` (product, ux, backend), `Chosen`, one or more `Rejected` lines (`option — why`), `Why`, and
`Decided by` (user, agent). The PR stack is a table: `#`, `Branch`, `Base`, `Fence`, `Size`, `Greptile focus`.

The UX section of a UI record ends with a `### Prototypes` subsection after the state table: exactly three
lines `- <id> — <name> — \`plans/<slug>-proto-<id>.html\`` (the frontmatter slug) with ids `a`, `b`, `c`, then a `Chosen: <id>` line.
Each file is a live HTML prototype of one rival direction; the human picks one at plan review.

## Checker rules

The checker reports `{ rule, detail }` for each failure. Rule ids are stable.

| Rule | Fails when |
|------|-----------|
| `frontmatter` | no frontmatter; `slug`, `title`, `ticket` or `date` missing; slug not kebab-case; ticket not a URL or `none` |
| `sections` | a required H2 is missing or out of order |
| `empty-section` | Summary, User and job, Fit, Success metric or Architecture has no text |
| `context-source` | a Context bullet lacks ` — source: ` (` - source: ` also passes) |
| `decisions` | no `D<n>` block, or a block lacks a valid Area, Chosen, Why, Decided by, or a Rejected line with a reason |
| `mermaid` | Flow (and UX) has no mermaid block, an empty one, an unknown first-line diagram type, or unbalanced `[ ] ( ) { }` |
| `ux-states` | the UX table lacks an Empty, Loading, Error or Success column |
| `prototypes` | `ui` is not `false` and UX lacks `### Prototypes`, has other than 3 lines of that form, ids other than a, b, c (or an id or slug that disagrees with its file name), or no `Chosen:` line naming one of them (` - ` also passes as separator) |
| `stack` | no rows; header not exactly `#, Branch, Base, Fence, Size, Greptile focus`; an empty Branch or Greptile focus cell; `#` not 1..n; a repeated branch; wrong base (PR 1 must use frontmatter `base`, PR n the branch of PR n-1); a fence with no backticked path; Size not S, M or L |
| `fence-overlap` | two PRs' fences share a path, or one is a directory prefix of the other, after dropping `./` and doubled slashes; `..` or absolute fence paths fail `stack` |

The `mermaid` rule is a syntax smell test, not a parse. It catches an empty block, a typo in the diagram
type and a missing bracket. It does not catch a bad edge or a label mermaid rejects, so a diagram can
pass here and still fail to render.

The checker tests structure only. A record can pass and still hold a weak plan; the plan judge and the
human review cover that.

Exit codes: 0 all rules pass, 1 a rule failed, 2 usage error or unreadable file.
