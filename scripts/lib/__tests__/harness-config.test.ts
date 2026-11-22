import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { configChecksum, HARNESS_DEFAULTS, loadHarnessConfig, normalizeDirectory, shownConfig, stableJson } from "../harness-config";

const load = (text: string | null) => loadHarnessConfig({ root: "/r", readFile: () => text });

describe("loadHarnessConfig", () => {
  it("a missing file is the defaults: a bare project must still run", () => {
    expect(load(null)).toEqual(Either.right(HARNESS_DEFAULTS));
  });

  it("keeps the ship block as given and leaves the other keys at their defaults", () => {
    const ship = { sharedFiles: [{ path: "x/", owner: "^x/" }] };
    const loaded = load(JSON.stringify({ ship }));
    expect(Either.isRight(loaded) && loaded.right.ship).toEqual(ship);
    expect(Either.isRight(loaded) && loaded.right.reviewBot).toEqual(HARNESS_DEFAULTS.reviewBot);
  });

  it("holds baseBranch to a plain branch name: it is written into git and gh command lines, so an option-like or dotted value must not load", () => {
    for (const good of ["staging", "release/v3.0", "v3/wave-1"]) {
      const loaded = load(JSON.stringify({ baseBranch: good }));
      expect(Either.isRight(loaded) && loaded.right.baseBranch, good).toBe(good);
    }
    for (const bad of ["--upload-pack=x", "a b", "a..b", "-x", "a;b", ""]) {
      expect(Either.isLeft(load(JSON.stringify({ baseBranch: bad }))), bad).toBe(true);
    }
  });

  it("refuses an unknown key inside ship, brandInit and a brandInit lane: a typo must not pass in silence", () => {
    for (const text of [
      '{"ship":{"sharedFile":[]}}',
      '{"brandInit":{"homeLanes":{}}}',
      '{"brandInit":{"homeLane":{"name":"h","motion":true,"owns":[],"extra":1}}}',
    ]) {
      expect(Either.isLeft(load(text)), text).toBe(true);
    }
  });

  it("refuses a primitive lane with no motion flag: brand-init loads the motion skills by it", () => {
    expect(Either.isLeft(load('{"brandInit":{"primitiveLanes":[{"name":"p","files":["a"]}]}}'))).toBe(true);
  });

  it("names the key at fault in one plain line", () => {
    const loaded = load('{"paths":{"tokens":4}}');
    expect(Either.isLeft(loaded) && loaded.left).toMatch(/^harness-config: paths\.tokens/);
  });
});

describe("stableJson and configChecksum", () => {
  it("sorts keys at every depth and writes no whitespace", () => {
    expect(stableJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });

  it("changes the checksum when any value changes: a garbled copy must not verify", () => {
    const changed = { ...HARNESS_DEFAULTS, coauthor: "other" };
    expect(configChecksum(changed)).not.toBe(configChecksum(HARNESS_DEFAULTS));
    expect(configChecksum(HARNESS_DEFAULTS)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("folder settings", () => {
  const paths = (value: Record<string, unknown>) => {
    const loaded = load(JSON.stringify({ paths: value }));
    if (Either.isLeft(loaded)) throw new Error(loaded.left);
    return loaded.right.paths;
  };

  it("regression: a folder loads in one form whatever its spelling: src/pages/ must not become src/pages// in a reader's pattern", () => {
    for (const spelling of ["src/pages", "src/pages/", "./src/pages/", "src//pages//"]) {
      expect(paths({ routes: spelling }).routes, spelling).toBe("src/pages");
    }
    expect(paths({ sourceRoots: ["app/", "./workers", "lib//"] }).sourceRoots).toEqual(["app", "workers", "lib"]);
    expect(normalizeDirectory("  a/b/ ")).toBe("a/b");
  });

  it("normalizes every folder key and docs.adr and docs.features, and keeps the file keys as typed", () => {
    const folders = ["components", "primitives", "routes", "locales", "schemas", "hooks", "trpc", "repositories", "appRoot"];
    const loaded = paths(Object.fromEntries(folders.map((key) => [key, `x/${key}/`])));
    for (const key of folders) expect(Reflect.get(loaded, key), key).toBe(`x/${key}`);
    const docs = load(JSON.stringify({ docs: { adr: "d/adr/", features: "./d/features/" } }));
    expect(Either.isRight(docs) && [docs.right.docs.adr, docs.right.docs.features]).toEqual(["d/adr", "d/features"]);
    expect(paths({ tokens: "./app.css", home: "a/home.tsx" })).toEqual({ tokens: "./app.css", home: "a/home.tsx" });
  });

  it("refuses a folder that names nothing, in one plain line that names the key: a root-level appRoot would match every path", () => {
    for (const bad of ["", ".", "./", "/"]) {
      const loaded = load(JSON.stringify({ paths: { appRoot: bad } }));
      expect(Either.isLeft(loaded) && loaded.left, bad).toBe("harness-config: paths.appRoot: must name a folder under the repo root");
    }
  });
});

describe("shared lanes", () => {
  it("takes a sequential flag on a shared lane and refuses it on the home lane: only a shared lane can run after the parallel ones", () => {
    const lane = { name: "a", motion: false, owns: ["x/**"] };
    expect(Either.isRight(load(JSON.stringify({ brandInit: { sharedLanes: [{ ...lane, sequential: true }] } })))).toBe(true);
    expect(Either.isLeft(load(JSON.stringify({ brandInit: { homeLane: { ...lane, sequential: true } } })))).toBe(true);
    expect(Either.isLeft(load(JSON.stringify({ brandInit: { sharedLanes: [{ ...lane, sequential: "yes" }] } })))).toBe(true);
  });
});

describe("shownConfig", () => {
  it("drops seedLogins and nothing else: the line a workflow journals must not hold passwords", () => {
    const config = { ...HARNESS_DEFAULTS, seedLogins: { admin: { email: "a@b.c", password: "pw" } } };
    const shown = shownConfig(config);
    expect(Object.keys(shown)).toEqual(Object.keys(config).filter((key) => key !== "seedLogins"));
    expect(JSON.stringify(shown)).not.toContain("pw");
  });
});
