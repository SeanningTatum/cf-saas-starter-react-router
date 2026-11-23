#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import {
  BUILD_PARTS,
  DEFAULT_BUILD_DIR,
  EXIT_CLEAN,
  EXIT_FOUND,
  EXIT_NO_BUILD,
  SANDBOX_MARKERS,
  SCANNED_EXTENSIONS,
  cleanLine,
  hitLine,
  noBuildLine,
} from "../lib/sandbox-absent-constants";

export interface SandboxHit {
  readonly file: string;
  readonly marker: string;
}

export interface ScanResult {
  readonly files: number;
  readonly hits: ReadonlyArray<SandboxHit>;
}

const listFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return SCANNED_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });

export const hitsIn = (file: string, text: string, markers: ReadonlyArray<string> = SANDBOX_MARKERS): SandboxHit[] =>
  markers.filter((marker) => text.includes(marker)).map((marker) => ({ file, marker }));

export function scanBuild(buildDir: string, markers: ReadonlyArray<string> = SANDBOX_MARKERS): ScanResult | null {
  const parts = BUILD_PARTS.map((part) => path.join(buildDir, part));
  if (!parts.every((part) => fs.existsSync(part))) return null;
  const files = parts.flatMap(listFiles);
  const hits = files.flatMap((file) => hitsIn(path.relative(buildDir, file), fs.readFileSync(file, "utf-8"), markers));
  return { files: files.length, hits };
}

export function run(argv: readonly string[], log: (line: string) => void): number {
  const dir = argv[0] ?? DEFAULT_BUILD_DIR;
  const result = scanBuild(dir);
  if (result === null) {
    log(noBuildLine(dir));
    return EXIT_NO_BUILD;
  }
  for (const hit of result.hits) log(hitLine(path.join(dir, hit.file), hit.marker));
  if (result.hits.length > 0) return EXIT_FOUND;
  log(cleanLine(dir, result.files));
  return EXIT_CLEAN;
}

if (import.meta.main) {
  process.exit(run(process.argv.slice(2), (line) => console.log(line)));
}
