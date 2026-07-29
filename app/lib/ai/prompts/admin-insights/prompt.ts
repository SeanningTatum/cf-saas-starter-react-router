import { JSONSchema, Schema } from "effect";
import { UserGrowthPoint, UserStats } from "@/lib/schemas/analytics";

/**
 * Prompt module: admin-insights
 *
 * Everything that changes model behavior lives in this file and is versioned
 * with it (see README.md for the bump rules). Provider is Workers AI
 * (`env.AI` binding) — no API key, no external SDK, runnable inside the
 * Worker at request time. Determinism comes from the pinned model id, the
 * schema-locked output (JSON Mode), and the frozen golden set — NOT from
 * sampling parameters, which we deliberately never send.
 */

export const TrendDirection = Schema.Literal("up", "down", "flat");
export type TrendDirection = typeof TrendDirection.Type;

export const Trend = Schema.Struct({
  label: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(60)),
  direction: TrendDirection,
  detail: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240)),
});
export type Trend = typeof Trend.Type;

export const DataQuality = Schema.Literal("sufficient", "sparse");
export type DataQuality = typeof DataQuality.Type;

export const AdminInsightsOutput = Schema.Struct({
  headline: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  trends: Schema.Array(Trend).pipe(Schema.minItems(1), Schema.maxItems(5)),
  suggestedActions: Schema.Array(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240))
  ).pipe(Schema.minItems(1), Schema.maxItems(4)),
  dataQuality: DataQuality,
});
export type AdminInsightsOutput = typeof AdminInsightsOutput.Type;

/** The analytics snapshot the prompt reasons over. Server-generated only. */
export const AdminInsightsInput = Schema.Struct({
  stats: UserStats,
  growth: Schema.Array(UserGrowthPoint),
  recentSignups7d: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});
export type AdminInsightsInput = typeof AdminInsightsInput.Type;

/**
 * JSON Schema handed to Workers AI `response_format.json_schema`. Derived
 * from the same Effect Schema that validates the response on the way out —
 * one contract, two enforcement points.
 */
export const outputJsonSchema = JSONSchema.make(
  AdminInsightsOutput
) as unknown as Record<string, unknown>;

// Stable prefix: byte-identical across every call. Volatile data goes in the
// user message, never interpolated here.
const SYSTEM = `You summarize SaaS user analytics for an admin dashboard.

Rules:
- Use ONLY the numbers in the snapshot. Never invent causes, campaigns, or events.
- "direction" compares the recent half of the growth series to the earlier half; use "flat" when the difference is noise (±10%).
- If the product is young or totals are near zero, set dataQuality to "sparse" and keep claims modest.
- Trends describe what happened; suggestedActions are concrete next steps an admin can take.
- Be concise. No markdown, no caveats about being an AI.`;

export const prompt = {
  id: "admin-insights",
  version: 1, // bump on any behavior change (see README.md rules)
  model: "@cf/moonshotai/kimi-k2.5", // pinned: a model swap is a new version
  // kimi-k2.5 reasons before answering and `reasoning_content` counts against
  // max_tokens (verified live 2026-07-29: 100 tokens → finish_reason "length"
  // with truncated content). 4000 leaves room for reasoning + full output.
  maxTokens: 4000,
  system: SYSTEM,
  render: (input: AdminInsightsInput) => [
    {
      role: "user" as const,
      content: `Analytics snapshot (JSON). Produce the insights object per the schema.\n${JSON.stringify(input)}`,
    },
  ],
};

/**
 * promptfoo entry point (eval-only, never imported by the Worker). Receives
 * `{ vars: { input } }` from tests.ts and returns full chat messages —
 * system prefix first, exactly as production sends them.
 */
export const renderForPromptfoo = (context: {
  vars: { input: AdminInsightsInput };
}) => [
  { role: "system", content: prompt.system },
  ...prompt.render(context.vars.input),
];
