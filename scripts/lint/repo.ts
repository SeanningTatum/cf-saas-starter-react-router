import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { SKIPPED_DIRS } from "./constants";
import type { Repo, Source } from "./types";

interface Disk {
  files(dir: string): string[];
  read(path: string): string | undefined;
}

function withSources(disk: Disk): Repo {
  const parsed = new Map<string, Source | undefined>();
  return {
    files: disk.files,
    read: disk.read,
    source(path) {
      if (parsed.has(path)) return parsed.get(path);
      const text = disk.read(path);
      const source =
        text === undefined ? undefined : { path, text, ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true) };
      parsed.set(path, source);
      return source;
    },
  };
}

function walk(root: string, dir: string, out: string[]): string[] {
  if (!existsSync(join(root, dir))) return out;
  for (const entry of readdirSync(join(root, dir)).sort()) {
    const path = `${dir}/${entry}`;
    if (!statSync(join(root, path)).isDirectory()) out.push(path);
    else if (!SKIPPED_DIRS.some((skipped) => skipped === entry)) walk(root, path, out);
  }
  return out;
}

export function diskRepo(root: string): Repo {
  return withSources({
    files: (dir) => walk(root, dir, []),
    read: (path) => {
      const full = join(root, path);
      return existsSync(full) && statSync(full).isFile() ? readFileSync(full, "utf8") : undefined;
    },
  });
}

export function memoryRepo(files: Record<string, string>): Repo {
  return withSources({
    files: (dir) =>
      Object.keys(files)
        .filter((path) => path.startsWith(`${dir}/`))
        .sort(),
    read: (path) => files[path],
  });
}
