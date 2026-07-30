import { resolve } from "node:path";

/**
 * Generic promptfoo prompt function for any prompt module. PROMPT_MODULE_DIR
 * (set by scripts/eval-prompt.sh) points at app/lib/ai/prompts/<name>; the
 * module's own renderForPromptfoo produces the chat messages — system prefix
 * first, exactly as production sends them.
 */
const moduleDir = process.env.PROMPT_MODULE_DIR;
if (!moduleDir) {
  throw new Error("PROMPT_MODULE_DIR is not set — run via scripts/eval-prompt.sh");
}
const { renderForPromptfoo } = await import(resolve(moduleDir, "prompt.ts"));

export default function render(context: { vars: { input: unknown } }) {
  return renderForPromptfoo(context);
}
