import { describe, expect, it } from "vitest";
import { childEnv, failure, redact, spawnRunner, succeeded, wrangler } from "../setup-run";

describe("spawnRunner", () => {
  it("passes input on standard input and argv as separate words, with no shell", () => {
    const result = spawnRunner("cat", ["-"], { input: "$(whoami) `id`" });
    expect(result).toEqual({ code: 0, stdout: "$(whoami) `id`", stderr: "" });
  });

  it("adds the given variables to the environment", () => {
    const result = spawnRunner("sh", ["-c", 'printf %s "$SETUP_TEST_VALUE"'], { env: { SETUP_TEST_VALUE: "visible" } });
    expect(result.stdout).toBe("visible");
  });

  it("keeps SETUP_ variables of the parent out of the child environment", () => {
    process.env.SETUP_PRODUCTION_TOKEN_160 = "parent-secret";
    try {
      const result = spawnRunner("sh", ["-c", 'printf %s "$SETUP_PRODUCTION_TOKEN_160"']);
      expect(result.stdout).toBe("");
      expect(childEnv().SETUP_PRODUCTION_TOKEN_160).toBeUndefined();
    } finally {
      delete process.env.SETUP_PRODUCTION_TOKEN_160;
    }
  });

  it("reports a command it cannot start as code 127 rather than throwing", () => {
    const result = spawnRunner("definitely-not-a-command-160", []);
    expect(result.code).toBe(127);
    expect(succeeded(result)).toBe(false);
  });
});

describe("redact and failure", () => {
  it("removes every occurrence of each secret", () => {
    expect(redact("a SECRET b SECRET c OTHER", ["SECRET", "OTHER"])).toBe("a [redacted] b [redacted] c [redacted]");
    expect(redact("nothing", [""])).toBe("nothing");
  });

  it("reports stderr first, redacted, and a status when there is no text", () => {
    expect(failure({ code: 1, stdout: "", stderr: "bad SECRET" }, ["SECRET"])).toBe("bad [redacted]");
    expect(failure({ code: 3, stdout: "", stderr: "" })).toBe("exited with status 3");
  });

  it("builds a wrangler call through bunx", () => {
    expect(wrangler(["secret", "list"])).toEqual(["bunx", ["wrangler", "secret", "list"]]);
  });
});
