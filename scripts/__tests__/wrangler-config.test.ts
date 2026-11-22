import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWranglerConfig,
  DUMMY_INPUT,
  parseJsonc,
  RATE_LIMITS,
  stripJsonc,
} from "../lib/wrangler-config";
import { RATE_LIMIT_BINDINGS, RATE_LIMIT_PERIOD_SECONDS } from "../../app/lib/constants/rate-limit";

interface RateLimitEntry {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}

interface WranglerShape {
  ratelimits?: RateLimitEntry[];
  env: { preview: { ratelimits?: RateLimitEntry[] } };
}

const committed = JSON.parse(
  stripJsonc(fs.readFileSync(path.join(__dirname, "..", "..", "wrangler.jsonc"), "utf-8"))
) as WranglerShape;

const built = buildWranglerConfig(DUMMY_INPUT) as WranglerShape;

describe("buildWranglerConfig", () => {
  it("rebuilds the committed wrangler.jsonc exactly, so setup and teardown cannot drop a binding", () => {
    expect(built).toEqual(committed);
  });

  it("binds every rate-limit rule the app names, at top level and in preview", () => {
    const names = Object.values(RATE_LIMIT_BINDINGS).sort();
    expect(built.ratelimits?.map((entry) => entry.name).sort()).toEqual(names);
    expect(built.env.preview.ratelimits?.map((entry) => entry.name).sort()).toEqual(names);
  });

  it("keeps the preview counters apart from production by giving them other namespace ids", () => {
    const top = new Set(built.ratelimits?.map((entry) => entry.namespace_id));
    const preview = built.env.preview.ratelimits?.map((entry) => entry.namespace_id) ?? [];
    expect(preview).toHaveLength(RATE_LIMITS.length);
    expect(preview.filter((id) => top.has(id))).toEqual([]);
  });

  it("uses the period the app sends as Retry-After, so the header never undercounts the wait", () => {
    const periods = [...(built.ratelimits ?? []), ...(built.env.preview.ratelimits ?? [])].map(
      (entry) => entry.simple.period
    );
    expect(new Set(periods)).toEqual(new Set([RATE_LIMIT_PERIOD_SECONDS]));
  });

  it("drops the R2 bucket from both blocks when setup runs without R2", () => {
    const withoutR2 = buildWranglerConfig({ ...DUMMY_INPUT, enableR2: false }) as Record<string, unknown> & {
      env: { preview: Record<string, unknown> };
    };
    expect(withoutR2).not.toHaveProperty("r2_buckets");
    expect(withoutR2.env.preview).not.toHaveProperty("r2_buckets");
    expect(withoutR2).toHaveProperty("ratelimits");
  });
});

describe("parseJsonc", () => {
  it("whole-line comments are dropped: teardown read a commented wrangler.jsonc as invalid", () => {
    const text = '// header\n{\n  // the worker\n  "name": "w",\n  "d1_databases": []\n}\n';
    expect(parseJsonc<{ name: string }>(text)).toEqual({ name: "w", d1_databases: [] });
  });

  it("text that is not JSON gives null, never a throw: teardown reports and goes on", () => {
    expect(parseJsonc("{ not json")).toBeNull();
  });
});
