# Features — Index

Per-feature memory. **One folder per feature** — `features/<slug>/` holds everything about that feature in one place: the memo, its browser-walk verification docs + screenshots, and any feature-specific run notes. Loaded by agents *before* touching a feature so they understand intent, existing surface, and how it was last proven to work.

## Folder shape

```
features/
├── index.md                    this file
├── _TEMPLATE.md                feature-memo template (copy to <slug>/<slug>.md)
├── _VERIFICATION_TEMPLATE.md   verification-doc template (copy to <slug>/verifications/<date>.md)
├── feature_list.json           machine-readable status registry (stays at root)
└── <slug>/
    ├── <slug>.md               the feature memo (purpose, runtime flow, key files, tagged errors, changelog)
    ├── verifications/<date>.md  feature-verifier verdicts (browser walk)
    ├── screenshots/            evidence captured by the feature-verifier
    └── runs/<date>-<slug>.md   feature-specific run notes (hybrid — see below)
```

> **Hybrid runs.** Feature-specific run notes live in `<slug>/runs/`. The global rolling cursor [`../runs/progress.md`](../runs/index.md) and cross-cutting task notes (harness changes, multi-feature refactors) stay in [`.brain/runs/`](../runs/index.md).

## When to read

- About to modify a feature → read `<slug>/<slug>.md` first, then its latest `verifications/` doc for known-good behavior
- Deciding scope of a new feature → check for adjacent features that overlap
- Investigating a bug → confirm expected behavior matches the memo + last verification

## When to write

- New feature ships → create `<slug>/<slug>.md` (from `_TEMPLATE.md`) in the same PR
- Bugfix that changes runtime behavior → append to the feature's changelog table
- User-visible flow verified → `feature-verifier` writes `<slug>/verifications/<date>.md` + screenshots
- Feature ripped out → **delete the whole `<slug>/` folder** (never leave stale memory)

## Conventions

- Folder + memo filename: `kebab-case` (e.g. `file-upload/file-upload.md`)
- `_Last updated: YYYY-MM-DD_` at top of the memo — refresh on every edit
- `Key Files` table in the memo = source of truth for what code belongs to the feature
- `Changelog` table appends newest entry on top
- Register the feature in the table below **and** in `feature_list.json`

## Files

> **Generated — do not hand-edit between the markers.** Run
> `brain features index --write`. `feature_list.json` is the source of truth and
> `brain check` fails on any disagreement. Without these markers the regenerator
> silently no-ops (`no-markers`), so this table could drift from the tracker
> indefinitely — which it did: it claimed `otel-tracing` was in-progress after it
> shipped, and omitted `sample-saas-landing` entirely.

<!-- brain:features-table -->
| Feature | Memo | Status | Latest verification |
|---------|------|--------|---------------------|
| Authentication | [`authentication/authentication.md`](authentication/authentication.md) | shipped | [2026-07-13 PASS](authentication/verifications/2026-07-13.md) |
| Admin Dashboard | [`admin-dashboard/admin-dashboard.md`](admin-dashboard/admin-dashboard.md) | shipped | — |
| File Upload | [`file-upload/file-upload.md`](file-upload/file-upload.md) | shipped | — |
| Analytics | [`analytics/analytics.md`](analytics/analytics.md) | shipped | — |
| Preview Deployments | [`preview-deployments/preview-deployments.md`](preview-deployments/preview-deployments.md) | shipped | — |
| Feature Verification | [`feature-verification/feature-verification.md`](feature-verification/feature-verification.md) | shipped | — |
| OpenTelemetry Span Tracing | [`otel-tracing/otel-tracing.md`](otel-tracing/otel-tracing.md) | shipped | [2026-07-29 PASS](otel-tracing/verifications/2026-07-29.md) |
| Sample SaaS Landing (Loadline) | [`sample-saas-landing/sample-saas-landing.md`](sample-saas-landing/sample-saas-landing.md) | cut | [2026-07-30 PASS](sample-saas-landing/verifications/2026-07-30.md) |
<!-- /brain:features-table -->

## Update trigger

Add a row when a feature folder is created; update the "Latest verification" cell when `feature-verifier` produces a new verdict; remove the row when the feature folder is deleted.

**`brain check` now FAILS on any disagreement between this table and
`feature_list.json`** (the "features/index.md agrees with the tracker" row), in
both directions — a wrong status and a missing row both fail. This table had
claimed `otel-tracing` was in-progress since it shipped, and omitted
`sample-saas-landing` entirely; nothing noticed, because nothing compared them.
`feature_list.json` is the source of truth — update both together.
