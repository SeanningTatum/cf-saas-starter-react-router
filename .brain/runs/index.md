# Runs — session continuity log

Per-task work logs. **Not** a changelog (`.brain/CHANGELOG.md` is). **Not** feature memory (`.brain/features/` is).

A run note records *the state of an in-progress or recently-finished task* so the next agent session — or the same session after compaction — can recover without re-diagnosing.

> **Two layers**: [`progress.md`](progress.md) is the rolling cursor (read at session start to recover "where am I"). Per-task `<date>-<slug>.md` files hold deep state for tasks >30min or multi-session.

## When to open a run note

- Task expected to span >30 min or multiple sessions
- Task is exploratory / debugging (where verification state matters)
- You hit something surprising and want to leave a breadcrumb

For trivial edits: skip. For everything else: cheap insurance.

## When to close a run note

- Task shipped → final entry, then either keep file or move to `transcripts/` if it carries durable decisions
- Task abandoned → final entry explaining why, then **delete the file** (do not leave stale runs)

## How to use

1. Copy [`_TEMPLATE.md`](_TEMPLATE.md) to `<YYYY-MM-DD>-<task-slug>.md`
2. Fill the Task / Plan section before writing code
3. Append a `## Step N` block as you work — verification results, dead ends, decisions
4. Final entry on close

## Conventions

- Filename: `YYYY-MM-DD-<kebab-slug>.md`
- Newest entries at the bottom (chronological — these are timelines, not docs)
- Quote test output verbatim — paraphrasing loses signal
- Link to commits / PRs / brain docs you touched

## Active runs

| Started | File | Status |
|---------|------|--------|
| _none yet_ | | |

(Add a row when you open a run note, remove when you close it.)
