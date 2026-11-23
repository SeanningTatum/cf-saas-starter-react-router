import { describe, it, expect } from "vitest";
import { ALLOW_MARKER, MAX_BYTES, listFiles, looksBinary, realDeps, run, scanPath, scanText, type Deps } from "../secret-scan";

// Every fake token is built at run time so this file holds no literal a real scanner would flag.
const alnum = (n: number, seed = "aB3dE5gH7jK9mN1pQ2sT4vW6yZ8") => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);
const rules = (text: string) => scanText("f.txt", text).map((f) => f.rule);

const FAKES = {
  "private-key": "-----BEGIN " + "RSA PRIVATE" + " KEY-----",
  "aws-access-key": "id = " + "AKIA" + "ABCDEFGHIJKLMNOP",
  "github-token": `t = ghp_${alnum(36)}`,
  "slack-token": `t = xoxb-${alnum(24)}`,
  "stripe-live-key": `k = sk_live_${alnum(24)}`,
  "google-api-key": `k = AIza${alnum(35)}`,
  "anthropic-key": `k = sk-ant-${alnum(30)}`,
  "openai-key": `k = sk-proj-${alnum(44)}`,
  "npm-token": `//registry.example/:_authToken=npm_${alnum(36)}`,
  "cloudflare-token-assignment": `CLOUDFLARE_API_TOKEN=${alnum(40)}`,
  "env-secret-assignment": `SESSION_SECRET=${"a1b2c3d4".repeat(8)}`,
  "secret-assignment": `const apiKey = "${alnum(36)}";`,
} satisfies Record<string, string>;

describe("scanText: each rule fires on a fake credential", () => {
  it.each(Object.entries(FAKES))("%s: a rule dropped from the list lets this shape through", (rule, line) => {
    expect(rules(line)).toContain(rule);
  });

  it("github-token also catches the fine-grained form", () => {
    expect(rules(`t = github_pat_${alnum(70)}`)).toContain("github-token");
  });

  it("cloudflare-token-assignment catches the preview token name too, not only the production one", () => {
    expect(rules(`CLOUDFLARE_PREVIEW_API_TOKEN=${alnum(40)}`)).toContain("cloudflare-token-assignment");
  });

  it("env-secret-assignment catches 64 hex from openssl rand, which has no mixed case", () => {
    expect(rules(`export BETTER_AUTH_SECRET=${"0123456789abcdef".repeat(4)}`)).toContain("env-secret-assignment");
    expect(rules(`DB_PASSWORD="${alnum(32)}"  # prod`)).toContain("env-secret-assignment");
  });

  it("cloudflare-token-assignment accepts the colon and quote form of a YAML or JSON file", () => {
    expect(rules(`CF_API_TOKEN: "${alnum(44)}"`)).toContain("cloudflare-token-assignment");
  });
});

describe("scanText: near misses stay quiet", () => {
  const quiet: [string, string][] = [
    ["a secrets reference in a workflow", "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}"],
    ["a shell variable", 'CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"'],
    ["process.env", "const token = process.env.CLOUDFLARE_API_TOKEN;"],
    ["a placeholder token", `CLOUDFLARE_API_TOKEN=your-token-goes-here-${"x".repeat(30)}`],
    ["a short token value", `const apiKey = "${alnum(20)}";`],
    ["a uuid", 'const secret = "123e4567-e89b-12d3-a456-426614174000";'],
    ["a lowercase-only long value", `const password = "${"a".repeat(40)}";`],
    ["a sha256 on a lockfile-style line", `integrity: "sha256-${alnum(43)}"`],
    ["a hex checksum named for what it is", `const tokenHash = "${"a1B2".repeat(8)}";`],
    ["a private key mention without the header", "the private key goes in the vault"],
    ["a short ghp prefix", `ghp_${alnum(10)}`],
    ["an env secret left as a placeholder", `BETTER_AUTH_SECRET=${"your-secret-here-".repeat(3)}`],
    ["an env secret that is a shell reference", `API_TOKEN=$(cat /run/secrets/${"x".repeat(30)})`],
    ["an env secret that is a file path", "TOKEN_FILE=/var/lib/some/very/long/path/to/a/token/file"],
    ["an env secret that is short", `SESSION_SECRET=${alnum(20)}`],
    ["an env name without a secret word", `BUCKET_NAME=${alnum(40)}`],
    ["a cloudflare token name with no literal", "CLOUDFLARE_PREVIEW_API_TOKEN: ${{ secrets.CLOUDFLARE_PREVIEW_API_TOKEN }}"],
    ["an AKIA word that is too short", "AKIA" + "SHORT"],
  ];
  it.each(quiet)("%s: a loose pattern would raise a false alarm here", (_name, line) => {
    expect(rules(line)).toEqual([]);
  });

  it("secret-assignment still fires on a 32-char hex value when the name is not a hash", () => {
    expect(rules(`const apiKey = "${"aB1".repeat(11).slice(0, 32)}";`)).toContain("secret-assignment");
  });

  it("secret-assignment skips a 64-char hex value named for a checksum", () => {
    expect(rules(`const tokenChecksum = "${"a1B2c3D4".repeat(8)}";`)).toEqual([]);
  });
});

describe("scanText: allow marker, line numbers and secrecy", () => {
  const awsLine = FAKES["aws-access-key"];

  it("a marker that names the rule skips only that line", () => {
    const text = [`${awsLine} // ${ALLOW_MARKER} aws-access-key`, awsLine].join("\n");
    expect(scanText("f.txt", text)).toEqual([{ path: "f.txt", line: 2, rule: "aws-access-key" }]);
  });

  it("a bare marker allows nothing: it must not hide a real key on the same line", () => {
    expect(rules(`${awsLine} // ${ALLOW_MARKER}`)).toEqual(["aws-access-key"]);
  });

  it("a marker for a different rule does not help", () => {
    expect(rules(`${awsLine} // ${ALLOW_MARKER} secret-assignment`)).toEqual(["aws-access-key"]);
  });

  it("a marker never allows a private key", () => {
    expect(rules(`${FAKES["private-key"]} // ${ALLOW_MARKER} private-key`)).toEqual(["private-key"]);
  });

  it("the marker for one rule leaves another rule on the same line live", () => {
    const line = `const apiKey = "${alnum(36)}"; // ${awsLine} ${ALLOW_MARKER} secret-assignment`;
    expect(rules(line)).toEqual(["aws-access-key"]);
  });

  it("the finding carries path, line and rule and never the secret text", () => {
    const secret = alnum(36);
    const found = scanText("a/b.ts", `\n\nconst apiKey = "${secret}";`);
    expect(found).toEqual([{ path: "a/b.ts", line: 3, rule: "secret-assignment" }]);
    expect(JSON.stringify(found)).not.toContain(secret);
  });
});

describe("scanPath: tracked-env-file", () => {
  it.each([".env", ".env.local", "apps/web/.env.production", ".dev.vars", ".dev.vars.staging"])(
    "%s is flagged: a committed env file holds real values",
    (file) => {
      expect(scanPath(file).map((f) => f.rule)).toEqual(["tracked-env-file"]);
    },
  );

  it.each([".env.example", ".dev.vars.example", ".env.template", "env.ts", "docs/.environment.md"])(
    "%s is not flagged: templates and lookalikes are fine",
    (file) => {
      expect(scanPath(file)).toEqual([]);
    },
  );
});

describe("looksBinary", () => {
  it("a NUL in the first 8 KB is binary, one after it is not", () => {
    const early = new Uint8Array(100);
    const late = new Uint8Array(9000).fill(65);
    late[8500] = 0;
    expect(looksBinary(early)).toBe(true);
    expect(looksBinary(late)).toBe(false);
  });
});

// --- run() with injected deps -------------------------------------------------

interface Fake {
  files: Record<string, string | Uint8Array>;
  gitOk?: boolean;
}

function depsFor(fake: Fake): { deps: Deps; lines: string[] } {
  const lines: string[] = [];
  const bytes = (f: string) => {
    const v = fake.files[f];
    return typeof v === "string" ? new TextEncoder().encode(v) : v;
  };
  const deps: Deps = {
    git: () => ({ ok: fake.gitOk ?? true, stdout: `${Object.keys(fake.files).join("\0")}\0` }),
    size: (f) => bytes(f)?.length,
    readFile: bytes,
    log: (line) => lines.push(line),
  };
  return { deps, lines };
}

describe("run", () => {
  it("a clean tree exits 0 and says how many files it read", () => {
    const { deps, lines } = depsFor({ files: { "a.ts": "const x = 1;", "b.ts": "const y = 2;" } });
    expect(run(deps)).toBe(0);
    expect(lines).toEqual(["ok: scanned 2 files, no secrets found"]);
  });

  it("a finding exits 1, prints path:line  rule, and ends with the allow hint", () => {
    const { deps, lines } = depsFor({ files: { "a.ts": `x\n${FAKES["github-token"]}` } });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toBe("a.ts:2  github-token");
    expect(lines.at(-2)).toContain(`${ALLOW_MARKER} <rule>`);
  });

  it("no line printed on a hit contains the secret", () => {
    const { deps, lines } = depsFor({ files: { "a.ts": FAKES["openai-key"] } });
    run(deps);
    expect(lines.join("\n")).not.toContain(alnum(44));
  });

  it("git that cannot run is an error and exit 1: a scan that did not run is not a pass", () => {
    const { deps, lines } = depsFor({ files: { "a.ts": "x" }, gitOk: false });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toMatch(/^error:/);
  });

  it("skips binaries, files over 1 MB and bun.lock, and does not count them", () => {
    const secret = FAKES["github-token"];
    const binary = new Uint8Array([0, ...new TextEncoder().encode(secret)]);
    const big = `${secret}\n${"a".repeat(MAX_BYTES)}`;
    const { deps, lines } = depsFor({
      files: { "img.png": binary, "big.txt": big, "bun.lock": secret, "ok.ts": "const x = 1;" },
    });
    expect(run(deps)).toBe(0);
    expect(lines).toEqual(["notice: skipped 2 binary or large files (not scanned)", "ok: scanned 1 files, no secrets found"]);
  });

  it("a clean tree with nothing skipped prints no notice", () => {
    const { deps, lines } = depsFor({ files: { "a.ts": "x" } });
    run(deps);
    expect(lines.some((l) => l.startsWith("notice:"))).toBe(false);
  });

  it("the skip notice also shows when the scan fails, so a failure never hides what was not read", () => {
    const { deps, lines } = depsFor({ files: { "a.ts": FAKES["github-token"], "img.png": new Uint8Array([0]) } });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toBe("notice: skipped 1 binary or large files (not scanned)");
  });

  it("a tracked .env file fails even when its content is harmless", () => {
    const { deps, lines } = depsFor({ files: { ".env": "A=1" } });
    expect(run(deps)).toBe(1);
    expect(lines[0]).toBe(".env:1  tracked-env-file");
  });

  it("a file git lists but the disk no longer has is skipped, not an error", () => {
    const { deps } = depsFor({ files: { "a.ts": "x" } });
    const gone: Deps = { ...deps, git: () => ({ ok: true, stdout: "gone.ts\0a.ts\0" }), size: (f) => (f === "a.ts" ? 1 : undefined) };
    expect(run(gone)).toBe(0);
  });
});

describe("listFiles", () => {
  it("splits on NUL, drops blanks and duplicates (a file can be cached and modified)", () => {
    const git = () => ({ ok: true, stdout: "a b.ts\0c.ts\0a b.ts\0" });
    expect(listFiles({ git })).toEqual(["a b.ts", "c.ts"]);
  });

  it("asks git for tracked files plus new unignored ones", () => {
    let seen: string[] = [];
    listFiles({
      git: (args) => {
        seen = args;
        return { ok: true, stdout: "" };
      },
    });
    expect(seen).toEqual(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  });
});

describe("the real tree", () => {
  it("passes the scan with the real git runner: a committed secret fails the unit tests too", () => {
    const lines: string[] = [];
    const deps: Deps = { ...realDeps(), log: (line) => lines.push(line) };
    expect(run(deps)).toBe(0);
    expect(lines.at(-1)).toMatch(/^ok: scanned \d+ files/);
  });
});
