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
| Workers AI returns "JSON Mode couldn't be met" | `ExternalServiceError` → 502; covered in `app/services/__tests__/ai.test.ts` |
| Response breaches the contract despite JSON Mode | `AiOutputError` → 502; covered in `__tests__/run.test.ts` |

## Running the eval

Deterministic graders run in CI via Vitest (`__tests__/golden-contract.test.ts`) —
no model calls. The live gate (requires a Cloudflare API token with Workers AI read):

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  npx promptfoo eval -c app/lib/ai/prompts/admin-insights/promptfooconfig.yaml
```

Any adversarial regression is a hard fail. A version bump voids the previous
baseline — re-run the eval before shipping the bump.

## Version changelog

- **v1** (2026-07-29) — initial module. Kimi K2.5, JSON Mode, 23 golden cases (9 happy / 8 edge / 6 adversarial, all synthetic).

## Version bump rules

Bump `prompt.version` for: system prompt edits, schema changes, model or
`maxTokens` changes. Do not bump for: comments, formatting, added golden
cases. Every bump needs a fresh promptfoo baseline.
