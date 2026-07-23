# Recipe: Before any task (init phase)

Run this once at the start of every non-trivial task. Cheap. Stops you from building on stale assumptions.

## 1. Frame the task

Answer in one sentence each (write into your run note — see [`../runs/_TEMPLATE.md`](../runs/_TEMPLATE.md)):

- **What is the user actually asking for?** (intent — not the literal words)
- **What domain?** architecture / repository / service / route / library / errors / frontend / cloudflare
- **What changes?** code only / brain only / both

If you cannot answer cleanly, ask the user. Do not start.

## 2. Read the brain (retrieval over recall)

Query via the **brain-axi CLI** (`brain`) — it emits token-efficient TOON and beats reading raw files:

1. `brain` — dashboard (in-progress feature, last checkpoint); `brain progress` — where you left off
2. [`CLAUDE.md`](../../CLAUDE.md) — only if you have not read it this session
3. `brain docs <domain>` then `brain docs view <sec/file>` for the matching layer's docs; `brain search "<keyword>"` for anything cross-cutting
4. For feature work: `brain features view <slug>`
5. `brain runs` / `brain runs view <name>` — past attempts, what failed, why

Skipping the brain is the most common failure mode. Training data does not reflect this repo.

## 3. Pick the runbook

If adding code, the matching recipe in [`./index.md`](./index.md) is your spine:
- New tRPC procedure → [`add-trpc-endpoint.md`](add-trpc-endpoint.md)
- New table → [`add-db-table.md`](add-db-table.md)
- New tagged error → [`add-tagged-error.md`](add-tagged-error.md)
- New CF binding → [`add-cf-binding.md`](add-cf-binding.md)
- New service → [`add-service.md`](add-service.md)
- New route → [`add-route.md`](add-route.md)
- New feature → [`add-feature.md`](add-feature.md)

If pure refactor / bugfix: open the rule file for the layer you are touching ([`.brain/rules/index.md`](../rules/index.md)).

## 4. Establish baseline

Before editing any file:

```bash
bun run typecheck
bun run test
```

Record both results in your run note. If anything fails *before* your changes, that is pre-existing — note it, do not silently "fix" unrelated breakage.

## 5. Open a run note + checkpoint (encouraged for >30min tasks)

- Feature work: `brain runs append <slug> --step "kickoff" --observed "<baseline tail>"` opens the per-feature run note.
- Otherwise copy [`../runs/_TEMPLATE.md`](../runs/_TEMPLATE.md) to `.brain/runs/<YYYY-MM-DD>-<task-slug>.md`.
- Always checkpoint: `brain progress add --summary "<framing>" --next "<first edit>"`.

Future sessions read these to recover state without re-running everything.

## Definition of done for init phase

- [ ] Task framed in one sentence
- [ ] Domain identified
- [ ] Relevant brain docs read (not skimmed — read)
- [ ] Recipe / rule file opened if applicable
- [ ] Baseline typecheck + test result captured
- [ ] (Long task) run note opened

Now proceed to the recipe / rule. End with [`99-verify-done.md`](99-verify-done.md).
