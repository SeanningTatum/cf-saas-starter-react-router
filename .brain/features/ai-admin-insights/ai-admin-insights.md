# Feature: AI Admin Insights

_Last updated: 2026-07-29_

## Purpose
Admin dashboard card that asks a pinned LLM to summarize recent signup/activity data into a structured insights object (headline, trends, suggested actions, data-quality flag). It is the starter's first LLM feature and the reference implementation of the prompt-engineering workflow from the `ai-toolkit` skills (`prompt-scaffold` / `prompt-eval` / `prompt-pipeline`, installed from `SeanningTatum/marketplace#15` via `skills-lock.json`): versioned prompt module, hand-labeled golden set, deterministic graders on Vitest, promptfoo config for live evals.

## When It's Used
- Admin opens `/admin` and clicks **Generate insights** on the AI insights card (below the deterministic `InsightsCard`).
- Never fires on page load — it is a paid, on-demand inference (tRPC **mutation** `analytics.getAiInsights`, `adminProcedure`).

## How It Works
1. `AiInsightsCard` (`app/components/analytics/ai-insights-card.tsx`) calls `api.analytics.getAiInsights.useMutation()`.
2. The procedure (`app/trpc/routes/analytics.ts`) gathers a fixed-shape snapshot from `AnalyticsRepository`: `getUserStats` + 30d `getUserGrowth` + 7d `getRecentSignupsCount` — the same shape as `AdminInsightsInput` and the golden set.
3. `generateAdminInsights` (`app/lib/ai/prompts/admin-insights/run.ts`) renders the prompt module (`prompt.ts`: id `admin-insights`, v1, pinned `@cf/moonshotai/kimi-k2.5`, no sampling params) and calls `WorkersAi.runJson` (`app/services/ai.ts`), which sends `response_format: json_schema` (Workers AI JSON Mode) with `outputJsonSchema = JSONSchema.make(AdminInsightsOutput)`.
4. The response (`response` field, string or object depending on model) is normalized and decoded against `AdminInsightsOutput`. Failures: transport/API → `ExternalServiceError` (502); unusable body → `AiOutputError` with `reason: invalid_json | schema_violation | empty_response` (502).
5. The card renders headline (+ "Limited data" badge when `dataQuality === "sparse"`), trends with direction icons, and suggested actions. i18n: `admin.ai_insights.*` (en + zh).

### Persistence details
- No new tables. Reads the existing `user` table via `AnalyticsRepository`.
- Prompt artifacts live in-repo: `app/lib/ai/prompts/admin-insights/` (`prompt.ts`, `run.ts`, `golden.jsonl`, `graders.ts`, `tests.ts`, `assert-golden.ts`, `promptfooconfig.yaml`, `README.md`).
- The `AI` binding was already declared in `wrangler.jsonc` (default + preview env); no wrangler change was needed.

### Testability
- `app/services/__tests__/ai.test.ts` — service: request shape (json_schema response_format), rejection → `ExternalServiceError`, missing binding → `ConfigurationError`.
- `__tests__/golden-contract.test.ts` — static golden-set gates (≥20 cases, ≥5 adversarial, unique ids, inputs decode, expected decodes against partial output schema, must_not parses) + grader unit tests. No live model calls.
- `__tests__/run.test.ts` — `generateAdminInsights` with a stub `WorkersAi`: string/object response, `invalid_json`, `empty_response`, `schema_violation`.
- `__tests__/prompt.test.ts` — module invariants (pinned model, single user message, stable system prompt, no sampling params).
- `app/lib/__tests__/effect-trpc.test.ts` — `AiOutputError → BAD_GATEWAY`.
- Live eval (manual, needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`): `npx promptfoo eval -c app/lib/ai/prompts/admin-insights/promptfooconfig.yaml` — same deterministic ladder via `tests.ts` + `assert-golden.ts`. Not in CI (paid + external).
- Feature verification: [verifications/2026-07-28.md](verifications/2026-07-28.md) — **PASS** against the live model (real headline + 3 trends + 4 actions + sparse badge on seeded data; admin gate both halves). First run FAILED with `empty_response` — root cause: kimi-k2.5 returns an OpenAI `chat.completion` object (`choices[0].message.content`), not `{ response }`; fixed in `WorkersAi.runJson` normalization + `maxTokens` 2000→4000 (`reasoning_content` counts against the budget). Card exposes `data-testid`s (`ai-insights-card`, `-generate`, `-empty`, `-error`, `-headline`, `-sparse-badge`, `-trends`, `-actions`).

## Key Files

| File | Role |
|------|------|
| `app/lib/ai/prompts/admin-insights/prompt.ts` | Prompt module — id/version/pinned model/system/render + Effect Schema output contract + derived JSON Schema |
| `app/lib/ai/prompts/admin-insights/run.ts` | Executor — calls `WorkersAi`, normalizes + decodes the response |
| `app/lib/ai/prompts/admin-insights/golden.jsonl` | 23 hand-labeled cases (9 happy / 8 edge / 6 adversarial, all synthetic) |
| `app/lib/ai/prompts/admin-insights/graders.ts` | Deterministic grader ladder (schema → expected → programmatic → must_not) |
| `app/lib/ai/prompts/admin-insights/promptfooconfig.yaml` | Live eval config (dev-only) + `tests.ts` / `assert-golden.ts` adapters |
| `app/lib/ai/prompts/admin-insights/README.md` | Contract doc: in/out, failure modes ↔ case ids, version rules |
| `app/services/ai.ts` | `WorkersAi` Effect Tag + Layer over the `AI` binding |
| `app/models/errors/ai.ts` | `AiOutputError` tagged error |
| `app/trpc/routes/analytics.ts` | `getAiInsights` admin mutation |
| `app/components/analytics/ai-insights-card.tsx` | UI card |
| `app/routes/admin/_index.tsx` | Mount point |

## Dependencies
- `AI` Workers binding (`@cf/moonshotai/kimi-k2.5` — structured outputs / JSON Mode supported; no API key)
- `promptfoo` (devDependency, eval only — never bundled)
- Existing: `AnalyticsRepository`, `adminProcedure`, shadcn `Card`/`Button`/`Badge`, lucide icons
- Effect `JSONSchema.make` (Effect Schema → JSON Schema for `response_format`)

## Tagged Errors

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| `ExternalServiceError` (service `WorkersAi`) | `WorkersAi.runJson` — `env.AI.run` rejection (incl. "JSON Mode couldn't be met") | BAD_GATEWAY |
| `ConfigurationError` (service `WorkersAi`, field `AI`) | `WorkersAiLive` — binding absent | INTERNAL_SERVER_ERROR |
| `AiOutputError` | `generateAdminInsights` — empty / non-JSON / schema-violating response | BAD_GATEWAY |

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-07-29 | feature | Scoped; ai-toolkit skills installed via skills-lock.json; provider switched Anthropic → Workers AI Kimi K2.5 per user direction; module + service + mutation + card implemented |
| 2026-07-29 | bugfix | Live verification caught `empty_response` on every call: kimi-k2.5 returns OpenAI `chat.completion` (`choices[0].message.content`), not `{ response }` — normalized in `WorkersAi.runJson`; `maxTokens` 2000→4000 (reasoning counts against budget). Re-verified PASS against the live model |
