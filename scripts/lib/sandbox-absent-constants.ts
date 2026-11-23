import { DEV_ROUTES } from "../../app/lib/constants/routes";
import { SANDBOX_BUILD_FLAG, SANDBOX_ENABLED_VAR, SANDBOX_ON } from "../../app/lib/constants/sandbox";
import { SANDBOX_LOAD_MANIFEST_SPAN, SANDBOX_LOAD_PAGE_SPAN, SANDBOX_RESOLVE_SELECTION_SPAN } from "../../app/lib/constants/spans";

export const SANDBOX_MARKERS: ReadonlyArray<string> = [
  DEV_ROUTES.sandboxManifest,
  SANDBOX_ENABLED_VAR,
  SANDBOX_LOAD_PAGE_SPAN,
  SANDBOX_LOAD_MANIFEST_SPAN,
  SANDBOX_RESOLVE_SELECTION_SPAN,
  "routes/sandbox/",
];

export const DEFAULT_BUILD_DIR = "build";
export const BUILD_PARTS = ["server", "client"] as const;
export const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set([".js", ".mjs", ".json", ".html", ".map"]);

export const EXIT_CLEAN = 0;
export const EXIT_FOUND = 1;
export const EXIT_NO_BUILD = 2;

export const noBuildLine = (dir: string): string =>
  `sandbox-absent: ${dir}/server or ${dir}/client is missing. Run \`bun run build\` first; a check with nothing to read is a failure.`;
export const hitLine = (file: string, marker: string): string =>
  `${file} sandbox-absent: holds "${marker}", so sandbox code reached a build made without ${SANDBOX_BUILD_FLAG}=${SANDBOX_ON}. Keep sandbox routes inside the SANDBOX_BUILD branch of app/routes.ts and import app/lib/sandbox/ only from them.`;
export const cleanLine = (dir: string, files: number): string => `sandbox-absent: ${files} files under ${dir} hold no sandbox code.`;
