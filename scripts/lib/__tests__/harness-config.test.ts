import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { configChecksum, HARNESS_DEFAULTS, loadHarnessConfig, stableJson } from "../harness-config";

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
