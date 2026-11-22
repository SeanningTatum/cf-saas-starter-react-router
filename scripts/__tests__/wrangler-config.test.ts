import { describe, it, expect } from "vitest";
import { parseJsonc } from "../lib/wrangler-config";

describe("parseJsonc", () => {
  it("whole-line comments are dropped: teardown read a commented wrangler.jsonc as invalid", () => {
    const text = '// header\n{\n  // the worker\n  "name": "w",\n  "d1_databases": []\n}\n';
    expect(parseJsonc<{ name: string }>(text)).toEqual({ name: "w", d1_databases: [] });
  });

  it("a // inside a string value survives: URLs in the config must not be cut", () => {
    expect(parseJsonc<{ url: string }>('{ "url": "https://x.test" }')).toEqual({ url: "https://x.test" });
  });

  it("text that is not JSON gives null, never a throw: teardown reports and goes on", () => {
    expect(parseJsonc("{ not json")).toBeNull();
  });
});
