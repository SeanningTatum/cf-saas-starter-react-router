import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  confirm: vi.fn(async () => true),
  text: vi.fn(async () => ""),
  password: vi.fn(async () => ""),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
}));

import { upsertEnvLine } from "../first-time-setup";

const source = readFileSync(new URL("../first-time-setup.ts", import.meta.url), "utf-8");

describe("how the wizard hands over a secret", () => {
  it("never builds a shell line around a secret: a command string shows in the process list", () => {
    expect(source).not.toMatch(/echo\s+["'`]?\$\{/);
    expect(source).not.toMatch(/\|\s*(bunx\s+)?wrangler\s+(versions\s+)?secret/);
  });

  it("leaves every secret and variable to the readiness pass, which sends them on standard input", () => {
    expect(source).toContain("runPass");
    expect(source).not.toContain("gh secret set");
    expect(source).not.toContain("wrangler secret put");
  });

  it("keeps the variables already set when it writes wrangler.jsonc again (#144)", () => {
    expect(source).toContain("preserveVars(readWranglerJsonc()");
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

describe("runDatabaseMigrations", () => {
  it("never runs drizzle-kit generate: the wizard once wrote a migration no one reviewed and applied it to production", () => {
    const source = readFileSync(new URL("../first-time-setup.ts", import.meta.url), "utf-8");
    expect(source).not.toMatch(/drizzle-kit\s+generate/);
  });
});
