import path from "node:path";
import lint from "@commitlint/lint";
import load from "@commitlint/load";

const ROOT = path.join(__dirname, "..", "..", "..");
const COMMIT_CONFIG_FILE = ".commitlintrc.json";
const PR_TITLE_CONFIG_FILE = ".commitlintrc.title.json";

export interface TitleVerdict {
  valid: boolean;
  problems: string[];
}

const loadRepoConfig = (file: string) => load({}, { cwd: ROOT, file });

const EMPTY_TITLE_PROBLEM = "the title is empty";

const lintWith = async (file: string, title: string): Promise<TitleVerdict> => {
  if (title.trim() === "") return { valid: false, problems: [EMPTY_TITLE_PROBLEM] };
  const config = await loadRepoConfig(file);
  const outcome = await lint(title, config.rules, {
    parserOpts: config.parserPreset?.parserOpts ?? {},
    plugins: config.plugins,
    ignores: config.ignores,
    defaultIgnores: config.defaultIgnores,
  });
  const found = [...outcome.errors, ...outcome.warnings];
  return { valid: outcome.valid, problems: found.map((f) => f.message) };
};

export const lintTitle = (title: string): Promise<TitleVerdict> => lintWith(COMMIT_CONFIG_FILE, title);

export const lintPrTitle = (title: string): Promise<TitleVerdict> => lintWith(PR_TITLE_CONFIG_FILE, title);
