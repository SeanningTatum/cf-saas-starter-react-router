import { describe, expect, it } from "vitest";
import {
  GIT_READ_LOCAL,
  GIT_READ_WORKTREE,
  GIT_WRITE_LOCAL,
  GIT_WRITE_WORKTREE,
  HOOKS_DIR,
  HOOKS_PATH,
  WRAPPER_DIR,
} from "../install-hooks-constants";

describe("install-hooks-constants", () => {
  it("points core.hooksPath at the wrapper folder inside the hooks folder", () => {
    expect(HOOKS_PATH).toBe(`${HOOKS_DIR}/${WRAPPER_DIR}`);
  });

  it("writes the per-worktree setting with --worktree: without the flag git writes the config every worktree shares", () => {
    expect(GIT_WRITE_WORKTREE).toEqual(["config", "--worktree", "core.hooksPath", HOOKS_PATH]);
    expect(GIT_WRITE_LOCAL).toEqual(["config", "core.hooksPath", HOOKS_PATH]);
  });

  it("reads the value in the scope it would write, so an already-set value is seen", () => {
    expect(GIT_READ_WORKTREE).toContain("--worktree");
    expect(GIT_READ_LOCAL).toContain("--local");
  });
});
