export const EXIT = { clean: 0, findings: 1, toolFailed: 2 } as const;
export const SPAWN_FAILED_STATUS = 127;
export const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

export const TOOL = { biome: "biome", house: "house", importCycles: "import-cycles", deadCode: "dead-code" } as const;

export const BIOME_BIN = "node_modules/.bin/biome";
export const KNIP_BIN = "node_modules/.bin/knip";
export const HOUSE_SCRIPT = "lint:house";

export const IMPORT_CYCLE_RULE = "suspicious/noImportCycles";
export const FORMAT_CATEGORY = "format";
export const FORMAT_FIX = "This file is not formatted. Do this instead: run `bun run format`.";

export const DEAD_CODE_FIX = {
  files: "Nothing imports this file. Do this instead: delete it, or import it where it is needed.",
  dependencies: "No source file imports this package. Do this instead: `bun remove` it.",
  devDependencies: "No script, config or test uses this dev package. Do this instead: `bun remove` it.",
  unlisted: "This package is imported but not in package.json. Do this instead: `bun add` it, or import the listed package.",
  unresolved: "This import resolves to nothing. Do this instead: fix the path.",
  binaries: "This command is not provided by a listed package. Do this instead: `bun add -d` the package that provides it.",
  exports: "Nothing imports this export. Do this instead: drop `export`, or delete it if the file does not use it either.",
  types: "Nothing imports this exported type. Do this instead: drop `export`, or delete it if the file does not use it either.",
  duplicates: "The same value is exported under two names. Do this instead: keep one.",
  enumMembers: "Nothing reads this enum member. Do this instead: delete it.",
  namespaceMembers: "Nothing reads this namespace member. Do this instead: delete it.",
  optionalPeerDependencies:
    "This optional peer package is imported but not in package.json. Do this instead: `bun add` it, or guard the import.",
  subpaths: "This package.json `imports` entry points at nothing that is used. Do this instead: delete the entry.",
  catalog: "No package uses this catalog entry. Do this instead: delete the entry.",
  catalogReferences: "This catalog reference names an entry that does not exist. Do this instead: add the entry, or pin a version.",
} as const;

export const HOUSE_FINDING = /^(\S+?):(\d+)(?::(\d+))? (\S+): (.*)$/;
export const HOUSE_RULE_PREFIX = "house/";

export const LINTABLE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$/;
export const STAGED_FILES_ARGS = ["diff", "--cached", "--name-only", "--diff-filter=ACMR"] as const;
