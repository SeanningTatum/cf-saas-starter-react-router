import { describe, expect, it } from "vitest";
import { globToRegExp } from "../glob";

const matches = (glob: string, path: string): boolean => globToRegExp(glob).test(path);

describe("globToRegExp", () => {
  it.each([
    ["app/**/index.ts", "app/index.ts", true],
    ["app/**/index.ts", "app/a/b/index.ts", true],
    ["app/**/index.ts", "app/xindex.ts", false],
    ["**/x.ts", "x.ts", true],
    ["**/x.ts", "a/b/x.ts", true],
    ["app/**/components/**", "app/routes/admin/components/table.tsx", true],
    ["app/**/components/**", "app/routes/admin/components-old/table.tsx", false],
  ])("** spans any depth, including none: %s on %s is %s", (glob, path, expected) => {
    expect(matches(glob, path)).toBe(expected);
  });

  it.each([
    ["app/routes/**", "app/routes/home.tsx", true],
    ["app/routes/**", "app/routes/admin/users.tsx", true],
    ["app/routes/**", "app/routes.ts", false],
    ["app/routes/**", "app/routes-old/home.tsx", false],
  ])("a trailing /** takes the whole folder and no sibling whose name starts the same: %s on %s is %s", (glob, path, expected) => {
    expect(matches(glob, path)).toBe(expected);
  });

  it("a single * stays inside one segment, so a folder glob does not reach into subfolders", () => {
    expect(matches("app/*.ts", "app/x.ts")).toBe(true);
    expect(matches("app/*.ts", "app/lib/x.ts")).toBe(false);
  });

  it("a dot in the glob is literal, so *.machine.ts does not match any character in its place", () => {
    expect(matches("*.machine.ts", "door.machine.ts")).toBe(true);
    expect(matches("*.machine.ts", "xmachinexts")).toBe(false);
  });

  it("a $ in a file name is literal, not an end anchor that would make the route file unmatchable", () => {
    expect(matches("app/routes/api/auth.$.ts", "app/routes/api/auth.$.ts")).toBe(true);
    expect(matches("app/routes/api/auth.$.ts", "app/routes/api/auth.x.ts")).toBe(false);
  });

  it("an exact path matches only itself, with no prefix or suffix slack", () => {
    expect(matches("app/runtime.ts", "app/runtime.ts")).toBe(true);
    expect(matches("app/runtime.ts", "app/runtime.tsx")).toBe(false);
    expect(matches("app/runtime.ts", "x/app/runtime.ts")).toBe(false);
    expect(matches("app/runtime.ts", "app/runtime")).toBe(false);
  });
});
