// Regenerates output-schema.json for the eval proxy from the prompt module —
// run before every eval (scripts/eval-admin-insights.sh does). The proxy's
// request defaults (schema, token floor, reasoning effort) come from the same
// source of truth as production: prompt.ts.
import {
  outputJsonSchema,
  prompt,
} from "../../app/lib/ai/prompts/admin-insights/prompt";

const out = {
  response_format: {
    type: "json_schema",
    json_schema: outputJsonSchema,
  },
  max_tokens: prompt.maxTokens,
  reasoning_effort: prompt.effort,
};

await Bun.write(
  new URL("./output-schema.json", import.meta.url),
  JSON.stringify(out, null, 2) + "\n"
);
console.log("wrote scripts/ai-eval-proxy/output-schema.json");
