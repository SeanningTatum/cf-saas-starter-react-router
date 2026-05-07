# Features — Index

Per-feature memory. **One MD per shipped or in-progress feature** — captures purpose, runtime flow, key files, dependencies, tagged errors, changelog. Loaded by agents *before* touching a feature so they understand intent and existing surface.

## When to read

- About to modify a feature → read its file first
- Deciding scope of a new feature → check for adjacent features that overlap
- Investigating a bug → confirm expected behavior matches what's documented

## When to write

- New feature ships → create the file in the same PR
- Bugfix that changes runtime behavior → append to feature's changelog table
- Feature ripped out → **delete the file** (never leave stale memory)

## Conventions

- Filename: `kebab-case.md` (e.g. `file-upload.md`)
- Use [`_TEMPLATE.md`](_TEMPLATE.md) as starting point
- `_Last updated: YYYY-MM-DD_` at top — refresh on every edit
- `Key Files` table = source of truth for what code belongs to feature
- `Changelog` table appends newest entry on top
- Register file in the index table below

## Files

| Feature | File | Status | Last updated |
|---------|------|--------|--------------|
| Authentication | [`authentication.md`](authentication.md) | shipped | 2026-05-07 |
| Admin Dashboard | [`admin-dashboard.md`](admin-dashboard.md) | shipped | 2026-05-07 |
| File Upload | [`file-upload.md`](file-upload.md) | shipped | 2026-05-07 |
| Analytics | [`analytics.md`](analytics.md) | shipped | 2026-05-07 |

## Important things to look at

- [`_TEMPLATE.md`](_TEMPLATE.md) — copy this for every new feature
- An existing feature's `Key Files` table mirrors the import surface — if you find a file not listed there, the doc is stale or the file is orphaned

## Update trigger

Add a row to the table above whenever a feature MD is created, and remove the row when the feature is deleted.
