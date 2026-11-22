const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/g;
const ANY_DEPTH = "\u0000";

export function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .split("/")
    .map((segment) => (segment === "**" ? ANY_DEPTH : segment.replace(REGEX_SPECIALS, "\\$&").replace(/\*/g, "[^/]*")))
    .join("/")
    .replaceAll(`${ANY_DEPTH}/`, "(?:.*/)?")
    .replaceAll(`/${ANY_DEPTH}`, "(?:/.*)?")
    .replaceAll(ANY_DEPTH, ".*");
  return new RegExp(`^${pattern}$`);
}
