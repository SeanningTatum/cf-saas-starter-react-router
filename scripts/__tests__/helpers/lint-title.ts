import path from "node:path";
import lint from "@commitlint/lint";
import load from "@commitlint/load";

const ROOT = path.join(__dirname, "..", "..", "..");
const CONFIG_FILE = ".commitlintrc.json";

export interface TitleVerdict {
  valid: boolean;
  problems: string[];
}

const loadRepoConfig = () => load({}, { cwd: ROOT, file: CONFIG_FILE });

const EMPTY_TITLE_PROBLEM = "the title is empty";

export const lintTitle = async (title: string): Promise<TitleVerdict> => {
  if (title.trim() === "") return { valid: false, problems: [EMPTY_TITLE_PROBLEM] };
  const config = await loadRepoConfig();
  const outcome = await lint(title, config.rules, {
    parserOpts: config.parserPreset?.parserOpts ?? {},
    plugins: config.plugins,
    ignores: config.ignores,
    defaultIgnores: config.defaultIgnores,
  });
  const found = [...outcome.errors, ...outcome.warnings];
  return { valid: outcome.valid, problems: found.map((f) => f.message) };
};
