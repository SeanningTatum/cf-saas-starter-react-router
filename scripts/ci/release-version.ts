#!/usr/bin/env bun
import fs from "node:fs";
import {
  BAD_SHA,
  COMMIT_SHA_PATTERN,
  EXIT_FAIL,
  EXIT_OK,
  FIELD_BREAK,
  LINE_BREAK,
  OUTPUT_KEY,
  RELEASE_TAG_PATTERN,
  TAG_REF_PREFIX,
  USAGE,
} from "../lib/release-version-constants";

export interface Deps {
  readInput: () => string;
  log: (line: string) => void;
}

type Version = readonly [number, number, number];

function versionOf(tag: string): Version | undefined {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(a: Version, b: Version): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

export function releaseTagsAt(listing: string, sha: string): string[] {
  const tags: string[] = [];
  for (const line of listing.split(LINE_BREAK)) {
    const [lineSha, ref] = line.trim().split(FIELD_BREAK);
    if (lineSha !== sha || ref === undefined || !ref.startsWith(TAG_REF_PREFIX)) continue;
    const tag = ref.slice(TAG_REF_PREFIX.length);
    if (versionOf(tag)) tags.push(tag);
  }
  return tags;
}

export function releaseVersion(listing: string, sha: string): string | undefined {
  if (!COMMIT_SHA_PATTERN.test(sha)) return undefined;
  let best: { tag: string; version: Version } | undefined;
  for (const tag of releaseTagsAt(listing, sha)) {
    const version = versionOf(tag);
    if (version && (best === undefined || isNewer(version, best.version))) best = { tag, version };
  }
  return best ? best.tag : sha;
}

export function run(argv: string[], deps: Deps): number {
  const [sha, ...rest] = argv;
  if (sha === undefined || rest.length > 0) {
    deps.log(USAGE);
    return EXIT_FAIL;
  }
  const version = releaseVersion(deps.readInput(), sha.trim().toLowerCase());
  if (version === undefined) {
    deps.log(BAD_SHA);
    return EXIT_FAIL;
  }
  deps.log(`${OUTPUT_KEY}=${version}`);
  return EXIT_OK;
}

function realDeps(): Deps {
  return {
    readInput: () => fs.readFileSync(0, "utf-8"),
    log: (line) => console.log(line),
  };
}

if (import.meta.main) {
  process.exit(run(process.argv.slice(2), realDeps()));
}
