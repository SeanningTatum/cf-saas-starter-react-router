import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SANDBOX_MARKERS, cleanLine, hitLine, noBuildLine } from "../sandbox-absent-constants";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), "utf-8");

describe("SANDBOX_MARKERS", () => {
  it("are strings the sandbox code really holds, so the scan cannot pass by looking for text that never ships", () => {
    const sources = [read("app/routes.ts"), read("app/lib/constants/routes.ts"), read("app/lib/constants/spans.ts"), read("app/lib/sandbox/gate.ts")].join(
      "\n",
    );
    for (const marker of SANDBOX_MARKERS) expect(sources, marker).toContain(marker);
  });

  it("never match the error tags the tRPC mapper ships in every build, which hold no sandbox code", () => {
    const tags = ["SandboxDisabledError", "SandboxUnknownModuleError", "SandboxUnknownScenarioError", "SandboxCaseNotDeclaredError"];
    for (const tag of tags)
      expect(
        SANDBOX_MARKERS.filter((marker) => tag.includes(marker)),
        tag,
      ).toEqual([]);
  });
});

describe("report lines", () => {
  it("name the file, the marker and the fix for a hit", () => {
    expect(hitLine("build/server/index.js", "/sandbox.json")).toMatch(
      /^build\/server\/index\.js sandbox-absent: holds "\/sandbox\.json".*VITE_SANDBOX=1.*SANDBOX_BUILD branch of app\/routes\.ts/,
    );
  });

  it("say what to run when the build is missing, and how much a clean scan read", () => {
    expect(noBuildLine("build")).toContain("bun run build");
    expect(cleanLine("build", 12)).toBe("sandbox-absent: 12 files under build hold no sandbox code.");
  });
});
