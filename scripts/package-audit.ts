#!/usr/bin/env bun
// Package audit gate: fails on a high or critical `bun audit` finding that
// .github/audit-allow.json does not allow. See docs/ci/supply-chain.md
import { Either, Schema } from "effect";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOW_FILE = ".github/audit-allow.json";

export interface Finding {
  package: string;
  severity: string;
  id: string;
  title: string;
}

export interface AllowEntry {
  id: string;
  package: string;
  reason: string;
  /** YYYY-MM-DD: the last day the entry allows. */
  expires: string;
}

interface Verdict {
  blocking: Finding[];
  allowed: Finding[];
  /** Entries that match a finding but ran out. */
  expired: AllowEntry[];
  /** Entries no finding matches. */
  stale: AllowEntry[];
}

// bun audit --json (Bun 1.2 and 1.4): an object keyed by package name, each
// value a list of advisories. Fields we do not read are ignored.
const Advisory = Schema.Struct({
  url: Schema.String,
  title: Schema.String,
  severity: Schema.String,
});
const AuditOutput = Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Array(Advisory) }));

const AllowFile = Schema.parseJson(
  Schema.Struct({
    allow: Schema.Array(
      Schema.Struct({
        id: Schema.NonEmptyString,
        package: Schema.NonEmptyString,
        reason: Schema.NonEmptyString,
        // A real calendar date: "2026-13-45" would otherwise compare as never expired.
        expires: Schema.String.pipe(
          Schema.pattern(/^\d{4}-\d{2}-\d{2}$/),
          Schema.filter(
            (s) => {
              const t = Date.parse(`${s}T00:00:00Z`);
              return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
            },
            { message: () => "expires must be a real YYYY-MM-DD date" },
          ),
        ),
      }),
    ),
  }),
);

const GHSA = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const KNOWN_SEVERITIES = new Set(["low", "moderate", "high", "critical"]);
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

/** The advisory id: the GHSA in the url, or the url when it has none. */
export function advisoryId(url: string): string {
  return GHSA.exec(url)?.[0] ?? url;
}

export function parseAudit(stdout: string): Either.Either<Finding[], string> {
  const decoded = Schema.decodeUnknownEither(AuditOutput)(stdout);
  if (Either.isLeft(decoded)) return Either.left("the output is not the JSON that bun audit --json prints");
  const findings = Object.entries(decoded.right).flatMap(([pkg, list]) =>
    list.map((a) => ({ package: pkg, severity: a.severity, id: advisoryId(a.url), title: a.title })),
  );
  return Either.right(findings);
}

export function parseAllow(text: string): Either.Either<AllowEntry[], string> {
  const decoded = Schema.decodeUnknownEither(AllowFile)(text);
  return Either.isLeft(decoded)
    ? Either.left(`${ALLOW_FILE} is malformed: expected {"allow":[{"id","package","reason","expires":"YYYY-MM-DD"}]}`)
    : Either.right([...decoded.right.allow]);
}

const sameAdvisory = (f: Finding, e: AllowEntry) => f.id === e.id && f.package === e.package;

/** High and critical count. So does a severity we do not know: fail safe. */
const counts = (severity: string) => {
  const s = severity.toLowerCase();
  return BLOCKING_SEVERITIES.has(s) || !KNOWN_SEVERITIES.has(s);
};

/** Split counted findings into blocking and allowed as of `today`; list entries that expired or match nothing. */
export function judge(findings: Finding[], allow: AllowEntry[], today: string): Verdict {
  const counted = findings.filter((f) => counts(f.severity));
  const live = allow.filter((e) => e.expires >= today);
  const isAllowed = (f: Finding) => live.some((e) => sameAdvisory(f, e));
  return {
    blocking: counted.filter((f) => !isAllowed(f)),
    allowed: counted.filter(isAllowed),
    expired: allow.filter((e) => e.expires < today && counted.some((f) => sameAdvisory(f, e))),
    stale: allow.filter((e) => !counted.some((f) => sameAdvisory(f, e))),
  };
}

// --- running ----------------------------------------------------------------

export interface Deps {
  /** Run `bun audit --json`. A non-zero status is normal when it finds something. */
  audit: () => { stdout: string; stderr: string; status: number };
  /** Text of the allow file, undefined when it does not exist. */
  readAllow: () => string | undefined;
  /** Today as YYYY-MM-DD. */
  today: () => string;
  log: (line: string) => void;
}

const firstLine = (text: string) =>
  text
    .split("\n")
    .find((l) => l.trim() !== "")
    ?.trim();

function blockingLine(f: Finding, expired: AllowEntry[]): string {
  const lapsed = expired.find((e) => sameAdvisory(f, e));
  const suffix = lapsed ? ` (allowance expired ${lapsed.expires})` : "";
  return `blocking: ${f.package} ${f.severity} ${f.id} ${f.title}${suffix}`;
}

/** Run the audit and return the exit code. Never throws. */
export function run(deps: Deps): number {
  const allowText = deps.readAllow();
  const allow = allowText === undefined ? Either.right<AllowEntry[]>([]) : parseAllow(allowText);
  if (Either.isLeft(allow)) {
    deps.log(`error: ${allow.left}`);
    return 1;
  }
  const out = deps.audit();
  const parsed = parseAudit(out.stdout);
  // A non-zero exit that reported nothing is a failed run, not a clean one.
  if (Either.isLeft(parsed) || (out.status !== 0 && parsed.right.length === 0)) {
    const why = Either.isLeft(parsed)
      ? (firstLine(out.stdout) ?? firstLine(out.stderr) ?? parsed.left)
      : (firstLine(out.stderr) ?? `bun audit exited with status ${out.status} and reported nothing`);
    deps.log(`error: the audit could not run: ${why}`);
    return 1;
  }

  const v = judge(parsed.right, allow.right, deps.today());
  for (const f of v.blocking) deps.log(blockingLine(f, v.expired));
  if (v.blocking.length > 0) deps.log(`fix: run \`bun update <package>\`, or add an entry with a reason and an expiry to ${ALLOW_FILE}`);
  if (v.allowed.length > 0) deps.log(`notice: ${v.allowed.length} known high or critical findings are allowed in ${ALLOW_FILE}`);
  for (const e of v.stale) deps.log(`notice: ${e.id} in ${e.package} is no longer reported; delete its entry from ${ALLOW_FILE}`);
  if (v.blocking.length > 0) return 1;
  deps.log("ok: no new high or critical findings");
  return 0;
}

export function realDeps(): Deps {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const allowPath = path.join(root, ALLOW_FILE);
  return {
    audit: () => {
      const out = spawnSync("bun", ["audit", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      return {
        stdout: out.stdout ?? "",
        stderr: out.error ? out.error.message : (out.stderr ?? ""),
        status: out.status ?? 1,
      };
    },
    readAllow: () => (fs.existsSync(allowPath) ? fs.readFileSync(allowPath, "utf-8") : undefined),
    today: () => new Date().toISOString().slice(0, 10),
    log: (line) => console.log(line),
  };
}

if (import.meta.main) {
  process.exit(run(realDeps()));
}
