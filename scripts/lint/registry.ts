import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RULES_DIR } from "./constants";
import type { Rule } from "./types";

const RULE_FILE = /^([a-z0-9-]+)\.ts$/;
const RULES_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "rules");

export interface Registry {
  rules: Rule[];
  problems: string[];
}

const isRule = (value: unknown): value is Rule => typeof value === "object" && value !== null && "id" in value && "check" in value && "cases" in value;

export async function loadRules(): Promise<Registry> {
  const rules: Rule[] = [];
  const problems: string[] = [];
  for (const file of readdirSync(RULES_FOLDER).sort()) {
    const name = RULE_FILE.exec(file)?.[1];
    if (!name) continue;
    const loaded: Record<string, unknown> | undefined = await import(pathToFileURL(join(RULES_FOLDER, file)).href).then(
      (module) => module,
      () => undefined,
    );
    const rule = loaded?.rule;
    if (!loaded) problems.push(`${RULES_DIR}/${file}: the file does not load; run \`bun ${RULES_DIR}/${file}\` to see why`);
    else if (!isRule(rule)) problems.push(`${RULES_DIR}/${file}: export the rule as \`export const rule: FileRule | RepoRule\``);
    else if (rule.id !== name) problems.push(`${RULES_DIR}/${file}: the rule's id is "${rule.id}"; name the file ${rule.id}.ts`);
    else rules.push(rule);
  }
  return { rules, problems };
}
