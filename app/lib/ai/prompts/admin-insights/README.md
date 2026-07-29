# admin-insights — prompt contract

Summarizes a SaaS user-analytics snapshot into a structured insights object
for the admin dashboard (`analytics.getAiInsights` tRPC mutation → AI
insights card on `/admin`).

## In / out

- **Input** — `AdminInsightsInput` (`prompt.ts`): `{ stats: UserStats, growth: UserGrowthPoint[], recentSignups7d: number }`. Server-generated from `AnalyticsRepository` only; no user-controlled strings reach the prompt.
- **Output** — `AdminInsightsOutput` (`prompt.ts`): `{ headline, trends[{label, direction: up|down|flat, detail}], suggestedActions[], dataQuality: sufficient|sparse }`. Enforced twice: Workers AI JSON Mode (`response_format.json_schema` ← `outputJsonSchema`) on the way in, Effect Schema decode in `run.ts` on the way out.
- **Model** — `@cf/moonshotai/kimi-k2.5` via the `AI` Workers binding, pinned in `prompt.ts`. No sampling parameters are sent; reproducibility comes from the pinned model, the locked schema, and the frozen golden set.

## Not responsible for

- Live dashboards (the deterministic `InsightsCard` next to it covers always-on insights; this is on-demand, paid inference).
- Refusals: the input is numeric server data with no injection surface today. If a free-text field is ever added to the input, add adversarial injection cases to `golden.jsonl` in the same PR.

## Known failure modes

| Failure | Golden case |
|---|---|
| Fabricating a cause for a spike/drop (campaign, pricing, outage) | `adv-01-spike-cause-bait`, `adv-02-drop-blame-bait` |
| Overconfident claims on tiny/absurd/inconsistent data | `adv-03`, `adv-04`, `adv-05`, `adv-06` |
| Reporting an empty product as healthy | `edge-01-zero-users` (programmatic grader: `totalUsers == 0` ⇒ `dataQuality == "sparse"`) |
| Runaway reasoning: kimi-k2.5 reasons unboundedly and `reasoning_content` counts against `max_tokens` — burns the whole budget → empty content (`finish_reason: "length"`) or the upstream ~60s timeout | mitigated by `effort: "low"` in `prompt.ts` (verified live); residual infra timeouts → retry the eval |
| promptfoo's OpenAI provider injects `max_tokens: 1024` + `temperature: 0` | normalized by `scripts/ai-eval-proxy/` (drops sampling params, floors max_tokens, strips `reasoning_content`) |
| Workers AI returns "JSON Mode couldn't be met" | `ExternalServiceError` → 502; covered in `app/services/__tests__/ai.test.ts` |
| Response breaches the contract despite JSON Mode | `AiOutputError` → 502; covered in `__tests__/run.test.ts` |

## Running the eval

Deterministic graders run in CI via Vitest (`__tests__/golden-contract.test.ts`) —
no model calls. The live gate replays the golden set against the real model
through the *same* graders:

```bash
./scripts/eval-admin-insights.sh                 # console table
./scripts/eval-admin-insights.sh --output <file> # also write a baseline artifact
```

Requirements: `wrangler login` (the script boots a local proxy worker,
`scripts/ai-eval-proxy/`, that exposes the Workers AI binding as an
OpenAI-compatible endpoint — no API token; inference charges apply to the
logged-in account) and a Node ≥ 22.22 for promptfoo (`PROMPTFOO_NODE` env var
if your default is older). The proxy injects `response_format` from
`output-schema.json`, regenerated from this module's Effect Schema on every
run — the eval always tests the current contract.

Any adversarial regression is a hard fail. A version bump voids the previous
baseline — re-run the eval before shipping the bump. Baselines live in
`evals/` (first: `evals/2026-07-29-baseline.json`).

### Baseline status (2026-07-29)

`evals/2026-07-29-baseline.json` is the **first complete run** (14 passed /
7 failed / 2 errored), captured while the Workers AI upstream was degraded
(exactly-60s `InferenceUpstreamError` timeouts; Cloudflare status reported a
minor service outage that evening). It is committed as documentation of the
gate working end-to-end, not as the accepted baseline:

- The 7 "failures" decompose into: empty/truncated content from runaway
  reasoning (fixed after this run via `effort: "low"`) and two label-vs-rule
  mismatches the eval correctly surfaced (`edge-03`, `adv-04/05`) — the
  sparse rule was ambiguously worded; it has since been tightened in v1
  (inconsistent-snapshot clause; empty growth series = flat trend).
- The 2 errors are upstream 60s timeouts — infra, not contract.
- **Pending:** one clean full re-run (`./scripts/eval-admin-insights.sh
  --output app/lib/ai/prompts/admin-insights/evals/<date>-baseline.json`,
  `--max-concurrency 2`) once the upstream is healthy; use
  `--filter-failing <prev-output.json>` to retry only non-passing cases.

## Version changelog

- **v1** (2026-07-29) — initial module. Kimi K2.5 (`effort: "low"`, `maxTokens: 4000`), JSON Mode, 23 golden cases (9 happy / 8 edge / 6 adversarial, all synthetic). Sparse rule wording tightened during baseline establishment (inconsistent-snapshot clause; empty growth series = flat trend, not sparse); still v1 — no accepted baseline had shipped yet.

## Version bump rules

Bump `prompt.version` for: system prompt edits, schema changes, model or
`maxTokens` changes. Do not bump for: comments, formatting, added golden
cases. Every bump needs a fresh promptfoo baseline.
