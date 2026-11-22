#!/usr/bin/env bun
// Secret scan gate: fails on a credential-shaped string in the working tree.
// A finding prints path, line and rule, never the matched text.
// See docs/ci/supply-chain.md
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Finding {
  path: string;
  line: number;
  rule: string;
}

/** `secret-scan: allow <rule>` on a line skips that one rule there. */
export const ALLOW_MARKER = "secret-scan: allow";
export const MAX_BYTES = 1024 * 1024;
const SNIFF_BYTES = 8 * 1024;
const SKIPPED_FILES = new Set(["bun.lock"]);
/** A private key line can never be allowed: there is no harmless one. */
const NEVER_ALLOWED = "private-key";

interface LineRule {
  rule: string;
  hit: (line: string) => boolean;
}

const pattern = (rule: string, ...res: RegExp[]): LineRule => ({
  rule,
  hit: (line) => res.some((re) => re.test(line)),
});

const PLACEHOLDER = /xxx|your|example|placeholder|changeme|replace/i;
const HASH_NAME = /hash|sha|checksum|integrity/i;
const HEX_LENGTHS = new Set([32, 40, 64]);

const CLOUDFLARE_ASSIGNMENT =
  /\b[A-Z0-9_]{0,40}(?:CLOUDFLARE|CF)[A-Z0-9_]{0,40}TOKEN[A-Z0-9_]{0,40}["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{40,})/;

/** A literal of 40 or more characters assigned to a Cloudflare token name. */
function cloudflareAssignment(line: string): boolean {
  const value = CLOUDFLARE_ASSIGNMENT.exec(line)?.[1];
  return value !== undefined && !PLACEHOLDER.test(value);
}

const ENV_ASSIGNMENT =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD)[A-Z0-9_]*)\s*=\s*["']?([A-Za-z0-9+/_=-]{32,})["']?\s*(?:#.*)?$/;

/** An env-style `NAME=value` line with a long literal, any case mix (64 hex from openssl counts). */
function envSecretAssignment(line: string): boolean {
  const value = ENV_ASSIGNMENT.exec(line)?.[2];
  return value !== undefined && !PLACEHOLDER.test(value) && !/^[./]/.test(value);
}

const SECRET_ASSIGNMENT =
  /([A-Za-z0-9_.-]{0,40})(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)([A-Za-z0-9_.-]*)["'`]?\s*[:=]\s*["'`]([A-Za-z0-9+/_=-]{32,})["'`]/i;

/** A long mixed-case quoted literal assigned to a secret-sounding name. */
function secretAssignment(line: string): boolean {
  const found = SECRET_ASSIGNMENT.exec(line);
  if (!found) return false;
  const [, before = "", after = "", value = ""] = found;
  const mixed = /\d/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value);
  if (!mixed) return false;
  const isHash = /^[0-9a-f]+$/i.test(value) && HEX_LENGTHS.has(value.length);
  return !(isHash && HASH_NAME.test(before + after));
}

const LINE_RULES: readonly LineRule[] = [
  pattern(NEVER_ALLOWED, /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/),
  pattern("aws-access-key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/),
  pattern("github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, /\bgithub_pat_[A-Za-z0-9_]{60,}\b/),
  pattern("slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/),
  pattern("stripe-live-key", /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/),
  pattern("google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/),
  pattern("anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/),
  pattern("openai-key", /\bsk-(proj-)?[A-Za-z0-9_-]{40,}\b/),
  pattern("npm-token", /\bnpm_[A-Za-z0-9]{36}\b/),
  { rule: "cloudflare-token-assignment", hit: cloudflareAssignment },
  { rule: "env-secret-assignment", hit: envSecretAssignment },
  { rule: "secret-assignment", hit: secretAssignment },
];

const ENV_FILE = /^(\.env|\.dev\.vars)(\..+)?$/;
const ENV_TEMPLATE = /\.(example|template)$/;

/** Path-level rule: a committed .env or .dev.vars file (templates are fine). */
export function scanPath(file: string): Finding[] {
  const name = path.posix.basename(file);
  const bad = ENV_FILE.test(name) && !ENV_TEMPLATE.test(name);
  return bad ? [{ path: file, line: 1, rule: "tracked-env-file" }] : [];
}

const MARKER_RULE = new RegExp(`${ALLOW_MARKER} ([a-z-]+)`, "g");

/** Rules this line allows by name. A bare marker allows nothing. */
function allowedRules(line: string): Set<string> {
  if (!line.includes(ALLOW_MARKER)) return new Set();
  const named = [...line.matchAll(MARKER_RULE)].map((m) => m[1] ?? "");
  return new Set(named.filter((rule) => rule !== NEVER_ALLOWED));
}

/** Findings in one file's text. Never carries the matched text. */
export function scanText(file: string, text: string): Finding[] {
  const found: Finding[] = [];
  text.split("\n").forEach((line, index) => {
    const allowed = allowedRules(line);
    for (const { rule, hit } of LINE_RULES) {
      if (!allowed.has(rule) && hit(line)) found.push({ path: file, line: index + 1, rule });
    }
  });
  return found;
}

/** True for content we do not scan: a NUL byte in the first 8 KB means binary. */
export function looksBinary(buf: Uint8Array): boolean {
  return buf.subarray(0, SNIFF_BYTES).includes(0);
}

// --- running ----------------------------------------------------------------

export interface Deps {
  git: (args: string[]) => { ok: boolean; stdout: string };
  /** Size in bytes, or undefined when the file is gone. */
  size: (file: string) => number | undefined;
  readFile: (file: string) => Uint8Array | undefined;
  log: (line: string) => void;
}

const LIST_FILES = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];

/** Files to scan, or undefined when git could not list them. */
export function listFiles(deps: Pick<Deps, "git">): string[] | undefined {
  const out = deps.git(LIST_FILES);
  if (!out.ok) return undefined;
  return [...new Set(out.stdout.split("\0").filter((f) => f !== ""))];
}

interface ScanResult {
  scanned: number;
  /** Binary or over-size files: counted so the skip is never silent. bun.lock is not counted. */
  skipped: number;
  findings: Finding[];
}

function scanTree(files: string[], deps: Deps): ScanResult {
  const result: ScanResult = { scanned: 0, skipped: 0, findings: [] };
  for (const file of files) {
    if (SKIPPED_FILES.has(path.posix.basename(file))) continue;
    const size = deps.size(file);
    if (size === undefined) continue;
    const buf = size > MAX_BYTES ? undefined : deps.readFile(file);
    if (size <= MAX_BYTES && buf === undefined) continue;
    if (buf === undefined || looksBinary(buf)) {
      result.skipped += 1;
      continue;
    }
    result.scanned += 1;
    result.findings.push(...scanPath(file), ...scanText(file, new TextDecoder().decode(buf)));
  }
  return result;
}

/** Run the scan and return the exit code. Never throws. */
export function run(deps: Deps): number {
  const files = listFiles(deps);
  if (files === undefined) {
    deps.log("error: git could not list the files, so nothing was scanned");
    return 1;
  }
  const { scanned, skipped, findings } = scanTree(files, deps);
  if (skipped > 0) deps.log(`notice: skipped ${skipped} binary or large files (not scanned)`);
  if (findings.length === 0) {
    deps.log(`ok: scanned ${scanned} files, no secrets found`);
    return 0;
  }
  for (const f of findings) deps.log(`${f.path}:${f.line}  ${f.rule}`);
  deps.log(
    `If a hit is a false alarm, add "${ALLOW_MARKER} <rule>" to that line (never honoured for ${NEVER_ALLOWED}).`,
  );
  deps.log(
    "If it is a real credential, rotate it first, then remove it. See docs/ci/supply-chain.md",
  );
  return 1;
}

export function realDeps(): Deps {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  return {
    git: (args) => {
      const out = spawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      });
      return { ok: out.error === undefined && out.status === 0, stdout: out.stdout ?? "" };
    },
    size: (file) => {
      const full = path.join(root, file);
      return fs.existsSync(full) && fs.statSync(full).isFile() ? fs.statSync(full).size : undefined;
    },
    readFile: (file) => fs.readFileSync(path.join(root, file)),
    log: (line) => console.log(line),
  };
}

if (import.meta.main) {
  process.exit(run(realDeps()));
}
