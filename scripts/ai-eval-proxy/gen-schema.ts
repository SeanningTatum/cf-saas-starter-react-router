// Regenerates output-schema.json for the eval proxy from a prompt module —
// run before every eval (scripts/eval-prompt.sh does). The proxy's request
// defaults (schema, token floor, reasoning effort) come from the same source
// of truth as production: the module's prompt.ts.
//
// Usage: bun run scripts/ai-eval-proxy/gen-schema.ts <module-name>
const name = process.argv[2];
if (!name) {
  console.error("usage: gen-schema.ts <module-name> (app/lib/ai/prompts/<name>)");
  process.exit(1);
}

const { outputJsonSchema, prompt } = await import(
  `../../app/lib/ai/prompts/${name}/prompt.ts`
);

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
console.log(`wrote scripts/ai-eval-proxy/output-schema.json (${name})`);
