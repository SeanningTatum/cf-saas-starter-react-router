import { describe, it, expect, vi, beforeEach } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

import { ghSpawn } from "../lib/gh";

describe("ghSpawn", () => {
  beforeEach(() => spawnSync.mockReset());

  it("a spawn error maps to code 127: callers read 127 as 'gh is not installed'", () => {
    spawnSync.mockReturnValue({ error: new Error("ENOENT"), status: null });
    const r = ghSpawn(["api", "x"]);
    expect(r.code).toBe(127);
    expect(r.stderr).toContain("ENOENT");
  });

  it("input reaches spawnSync: request bodies travel on stdin, not argv", () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "{}", stderr: "" });
    ghSpawn(["api", "-X", "POST", "p", "--input", "-"], '{"a":1}');
    expect(spawnSync).toHaveBeenCalledWith("gh", ["api", "-X", "POST", "p", "--input", "-"], {
      input: '{"a":1}',
      encoding: "utf8",
    });
  });

  it("a null status (killed by signal) maps to 1, never to success", () => {
    spawnSync.mockReturnValue({ status: null, stdout: null, stderr: null });
    expect(ghSpawn(["x"])).toEqual({ code: 1, stdout: "", stderr: "" });
  });
});
