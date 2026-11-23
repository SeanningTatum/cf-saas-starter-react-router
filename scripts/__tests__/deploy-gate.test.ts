import { describe, it, expect } from "vitest";
import { Either } from "effect";
import fs from "node:fs";
import path from "node:path";
import { decide, isRealD1Id, readCommittedD1Id, readStagingD1Id, run, withProductionD1, type Deps, type Facts } from "../ci/deploy-gate";
import { stripJsonc } from "../lib/wrangler-config";

const REAL_ID = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
const OTHER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ZERO_ID = "00000000-0000-0000-0000-000000000000";

const ready: Facts = {
  hasAccountId: true,
  hasToken: true,
  hasSeedSecret: true,
  prodTokenAtRepoLevel: false,
  committedD1Id: REAL_ID,
  d1Override: "",
  hasStagingUrl: true,
  stagingD1Id: OTHER_ID,
};
const facts = (over: Partial<Facts>): Facts => ({ ...ready, ...over });

function wrangler(top: string, preview = ZERO_ID, staging = ZERO_ID): string {
  return `// header comment line
{
  "name": "demo",
  "d1_databases": [
    { "binding": "DATABASE", "database_name": "demo-db", "database_id": "${top}", "migrations_dir": "./drizzle" }
  ],
  "env": {
    "preview": {
      "d1_databases": [
        { "binding": "DATABASE", "database_name": "demo-db-preview", "database_id": "${preview}" }
      ]
    },
    "staging": {
      "d1_databases": [
        { "binding": "DATABASE", "database_name": "demo-db-staging", "database_id": "${staging}" }
      ]
    }
  }
}
`;
}

const REAL_FILE = fs.readFileSync(path.join(__dirname, "..", "..", "wrangler.jsonc"), "utf-8");

function harness(env: Record<string, string>, files: Record<string, string> = { w: wrangler(ZERO_ID) }) {
  const out: string[] = [];
  const appended: Record<string, string> = {};
  const written: Record<string, string> = {};
  const deps: Deps = {
    env,
    readFile: (f) => files[f],
    writeFile: (f, t) => {
      written[f] = t;
    },
    appendFile: (f, t) => {
      appended[f] = (appended[f] ?? "") + t;
    },
    log: (l) => out.push(l),
    wranglerPath: "w",
  };
  return { deps, out, appended, written };
}

describe("isRealD1Id", () => {
  it("rejects the all-zero placeholder and junk: a placeholder must never count as set up", () => {
    expect(isRealD1Id(ZERO_ID)).toBe(false);
    expect(isRealD1Id("")).toBe(false);
    expect(isRealD1Id(undefined)).toBe(false);
    expect(isRealD1Id("not-a-uuid")).toBe(false);
    expect(isRealD1Id(`${REAL_ID} `)).toBe(false);
    expect(isRealD1Id(REAL_ID)).toBe(true);
  });
});

describe("decide production", () => {
  it("is ready with a real committed id: a set-up repo must deploy", () => {
    expect(decide("production", ready)).toEqual({ ready: true, reason: "ready", warnings: [] });
  });

  it("names the account variable first when both facts are missing: the cheaper fix comes first", () => {
    const d = decide("production", facts({ hasAccountId: false, committedD1Id: ZERO_ID }));
    expect(d.ready).toBe(false);
    expect(d.reason).toBe("the CLOUDFLARE_ACCOUNT_ID variable is not set");
  });

  it("blocks on the placeholder id and says how to fix it", () => {
    const d = decide("production", facts({ committedD1Id: ZERO_ID }));
    expect(d.ready).toBe(false);
    expect(d.reason).toBe('wrangler.jsonc still has the placeholder D1 id; run "bun run setup" or set the CLOUDFLARE_D1_DATABASE_ID variable');
  });

  it("is ready when the placeholder is overridden by the variable: this template keeps placeholders committed", () => {
    expect(decide("production", facts({ committedD1Id: ZERO_ID, d1Override: REAL_ID })).ready).toBe(true);
  });

  it("stays blocked when the override is itself a placeholder or junk: a bad variable must not pass the gate", () => {
    expect(decide("production", facts({ committedD1Id: ZERO_ID, d1Override: ZERO_ID })).ready).toBe(false);
    expect(decide("production", facts({ committedD1Id: ZERO_ID, d1Override: "oops" })).ready).toBe(false);
  });

  it("does not read the token or seed facts: the production token is an environment secret this job cannot see", () => {
    expect(decide("production", facts({ hasToken: false, hasSeedSecret: false })).ready).toBe(true);
  });
});

describe("decide preview and preview-cleanup", () => {
  it("names the first missing item: account id, then token, then seed secret", () => {
    const none = facts({ hasAccountId: false, hasToken: false, hasSeedSecret: false });
    expect(decide("preview", none).reason).toBe("neither the CLOUDFLARE_PREVIEW_ACCOUNT_ID nor the CLOUDFLARE_ACCOUNT_ID variable is set");
    expect(decide("preview", facts({ hasToken: false, hasSeedSecret: false })).reason).toBe("the CLOUDFLARE_PREVIEW_API_TOKEN secret is not set");
    expect(decide("preview", facts({ hasSeedSecret: false })).reason).toBe("the PREVIEW_SEED_SECRET secret is not set");
    expect(decide("preview", ready).ready).toBe(true);
  });

  it("cleanup needs the account id and token but not the seed secret: it only deletes a database", () => {
    expect(decide("preview-cleanup", facts({ hasSeedSecret: false })).ready).toBe(true);
    expect(decide("preview-cleanup", facts({ hasToken: false })).reason).toBe("the CLOUDFLARE_PREVIEW_API_TOKEN secret is not set");
  });

  it("ignores the D1 placeholder: previews use their own per-PR database", () => {
    expect(decide("preview", facts({ committedD1Id: ZERO_ID })).ready).toBe(true);
  });
});

describe("warnings", () => {
  it.each(["production", "preview", "preview-cleanup"] as const)(
    "%s warns when the production token sits at repo level: pull-request jobs can read it there",
    (target) => {
      const d = decide(target, facts({ prodTokenAtRepoLevel: true }));
      expect(d.warnings).toEqual([
        "a repo-level CLOUDFLARE_API_TOKEN secret is readable by pull-request jobs; move it to the production environment and delete the repo-level one",
      ]);
    },
  );

  it("warns even when the gate skips", () => {
    expect(decide("preview", facts({ hasToken: false, prodTokenAtRepoLevel: true })).warnings).toHaveLength(1);
  });
});

describe("readCommittedD1Id", () => {
  it("reads the top-level id and ignores the one in env.preview", () => {
    expect(readCommittedD1Id(wrangler(REAL_ID, OTHER_ID))).toEqual(Either.right(REAL_ID));
  });

  it("a placeholder in env.preview alone does not block production", () => {
    const id = Either.getOrUndefined(readCommittedD1Id(wrangler(REAL_ID, ZERO_ID)));
    expect(decide("production", facts({ committedD1Id: id })).ready).toBe(true);
  });

  it("the committed wrangler.jsonc of this repo reads as not set up: this template ships placeholders", () => {
    const id = Either.getOrUndefined(readCommittedD1Id(REAL_FILE));
    expect(id).toBe(ZERO_ID);
    expect(decide("production", facts({ committedD1Id: id })).ready).toBe(false);
  });

  it("returns an error for text that is not JSON or has no DATABASE binding", () => {
    expect(Either.isLeft(readCommittedD1Id("{ nope"))).toBe(true);
    expect(Either.isLeft(readCommittedD1Id('{"d1_databases": []}'))).toBe(true);
    expect(Either.isLeft(readCommittedD1Id('{"d1_databases": "x"}'))).toBe(true);
  });
});

describe("withProductionD1", () => {
  it("patches only the top-level DATABASE binding: env.preview keeps its own database", () => {
    const patched = Either.getOrThrow(withProductionD1(wrangler(ZERO_ID, OTHER_ID), REAL_ID));
    const json = JSON.parse(stripJsonc(patched));
    expect(json.d1_databases[0].database_id).toBe(REAL_ID);
    expect(json.env.preview.d1_databases[0].database_id).toBe(OTHER_ID);
    expect(json.d1_databases[0].database_name).toBe("demo-db");
    expect(json.name).toBe("demo");
  });

  it("keeps a one-line header saying the file is patched and never committed", () => {
    const patched = Either.getOrThrow(withProductionD1(wrangler(ZERO_ID), REAL_ID));
    expect(patched.split("\n")[0]).toMatch(/^\/\/ Patched by .*never committed/);
    expect(patched.split("\n").filter((l) => l.startsWith("//"))).toHaveLength(1);
  });

  it("rejects junk and zero ids: a typo in the variable must not reach wrangler", () => {
    for (const bad of ["", "abc", ZERO_ID, `${REAL_ID}; rm -rf`]) {
      expect(Either.isLeft(withProductionD1(wrangler(ZERO_ID), bad))).toBe(true);
    }
  });

  it("fails on a file with no DATABASE binding", () => {
    expect(Either.isLeft(withProductionD1('{"name":"x"}', REAL_ID))).toBe(true);
  });
});

describe("decide staging", () => {
  it("is ready with the account, a real staging D1 id and STAGING_URL, and needs no production id, so that staging deploys before production is set up", () => {
    expect(decide("staging", facts({ committedD1Id: ZERO_ID })).ready).toBe(true);
  });

  it("skips with a reason for each missing part, in order, so that a fresh fork stays green and the notice names the next step", () => {
    expect(decide("staging", facts({ hasAccountId: false })).reason).toBe("the CLOUDFLARE_ACCOUNT_ID variable is not set");
    expect(decide("staging", facts({ stagingD1Id: ZERO_ID })).reason).toContain("env.staging");
    expect(decide("staging", facts({ stagingD1Id: undefined })).reason).toContain("env.staging");
    expect(decide("staging", facts({ hasStagingUrl: false })).reason).toBe("the STAGING_URL variable is not set");
  });

  it("does not let the production override variable stand in for the staging id, so that staging can never be pointed at the production database", () => {
    expect(decide("staging", facts({ stagingD1Id: ZERO_ID, d1Override: REAL_ID })).ready).toBe(false);
  });
});

describe("readStagingD1Id", () => {
  it("reads the DATABASE id under env.staging and nothing else, so that the top-level id is never taken for staging", () => {
    expect(readStagingD1Id(wrangler(REAL_ID, ZERO_ID, OTHER_ID))).toEqual(Either.right(OTHER_ID));
    expect(readStagingD1Id('{"name":"x"}')).toEqual(Either.right(undefined));
    expect(Either.isLeft(readStagingD1Id('{"env":{"staging":{"d1_databases":"no"}}}'))).toBe(true);
  });

  it("finds the placeholder id in the committed wrangler.jsonc, so that this template skips staging until setup runs", () => {
    expect(readStagingD1Id(REAL_FILE)).toEqual(Either.right(ZERO_ID));
  });
});

describe("run ready", () => {
  it("reads the staging id from the file and skips staging with its own name while it is the placeholder", () => {
    const h = harness({ HAS_ACCOUNT_ID: "true", HAS_STAGING_URL: "true", GITHUB_OUTPUT: "out" });
    expect(run(["ready", "staging"], h.deps)).toBe(0);
    expect(h.out[0]).toMatch(/^::notice::Deploy Staging skipped: wrangler.jsonc has no real staging D1 id/);
    const set = harness({ HAS_ACCOUNT_ID: "true", HAS_STAGING_URL: "true", GITHUB_OUTPUT: "out" }, { w: wrangler(ZERO_ID, ZERO_ID, REAL_ID) });
    run(["ready", "staging"], set.deps);
    expect(set.out).toEqual(["ready"]);
    expect(set.appended.out).toBe("ready=true\n");
  });

  it("prints one notice, writes ready=false and exits 0 on a repo that is not set up", () => {
    const h = harness({ HAS_ACCOUNT_ID: "true", GITHUB_OUTPUT: "out" });
    expect(run(["ready", "production"], h.deps)).toBe(0);
    expect(h.out).toEqual([
      '::notice::Deploy Production skipped: wrangler.jsonc still has the placeholder D1 id; run "bun run setup" or set the CLOUDFLARE_D1_DATABASE_ID variable. See docs/ci/pipelines.md',
    ]);
    expect(h.appended.out).toBe("ready=false\n");
  });

  it("prints ready and writes ready=true when set up through the override variable", () => {
    const h = harness({ HAS_ACCOUNT_ID: "true", D1_DATABASE_ID: REAL_ID, GITHUB_OUTPUT: "out" });
    expect(run(["ready", "production"], h.deps)).toBe(0);
    expect(h.out).toEqual(["ready"]);
    expect(h.appended.out).toBe("ready=true\n");
  });

  it("uses each workflow's own name in the notice", () => {
    const names = { preview: "Preview Deploy", "preview-cleanup": "Preview Cleanup" };
    for (const [target, name] of Object.entries(names)) {
      const h = harness({});
      run(["ready", target], h.deps);
      expect(h.out[0]).toMatch(new RegExp(`^::notice::${name} skipped: `));
    }
  });

  it("prints each warning on its own ::warning:: line after the verdict", () => {
    const h = harness({ HAS_ACCOUNT_ID: "true", HAS_TOKEN: "true", HAS_SEED_SECRET: "true", PROD_TOKEN_AT_REPO_LEVEL: "true" });
    run(["ready", "preview"], h.deps);
    expect(h.out[0]).toBe("ready");
    expect(h.out[1]).toMatch(/^::warning::a repo-level CLOUDFLARE_API_TOKEN/);
  });

  it("writes nothing to GITHUB_OUTPUT when the variable is unset: local runs must not create files", () => {
    const h = harness({});
    run(["ready", "preview"], h.deps);
    expect(h.appended).toEqual({});
  });

  it("is an error with exit 1 when wrangler.jsonc is missing or invalid: a broken file is not 'not set up'", () => {
    const missing = harness({ HAS_ACCOUNT_ID: "true" }, {});
    expect(run(["ready", "production"], missing.deps)).toBe(1);
    expect(missing.out[0]).toMatch(/^::error::/);
    const junk = harness({ HAS_ACCOUNT_ID: "true" }, { w: "{ nope" });
    expect(run(["ready", "production"], junk.deps)).toBe(1);
    expect(junk.out[0]).toMatch(/^::error::/);
  });

  it("exits 2 on bad usage", () => {
    expect(run([], harness({}).deps)).toBe(2);
    expect(run(["ready"], harness({}).deps)).toBe(2);
    expect(run(["ready", "nowhere"], harness({}).deps)).toBe(2);
    expect(run(["ready", "preview", "extra"], harness({}).deps)).toBe(2);
    expect(run(["deploy"], harness({}).deps)).toBe(2);
  });
});

describe("stripJsonc", () => {
  it("removes whole-line comments only: a // inside a string value must survive", () => {
    const text = '// head\n  // indented\n{"url": "https://x.test", "a": 1}\n';
    expect(JSON.parse(stripJsonc(text))).toEqual({ url: "https://x.test", a: 1 });
  });
});

describe("run project-name", () => {
  it("prints the Worker name from wrangler.jsonc: cleanup must name the same database setup created", () => {
    const h = harness({});
    expect(run(["project-name"], h.deps)).toBe(0);
    expect(h.out).toEqual(["demo"]);
  });

  it("reads this repo's committed wrangler.jsonc", () => {
    const h = harness({}, { w: REAL_FILE });
    run(["project-name"], h.deps);
    expect(h.out[0]).toBe(JSON.parse(stripJsonc(REAL_FILE)).name);
  });

  it("errors with exit 1 when the file is missing or has no name", () => {
    expect(run(["project-name"], harness({}, {}).deps)).toBe(1);
    const h = harness({}, { w: '{"x":1}' });
    expect(run(["project-name"], h.deps)).toBe(1);
    expect(h.out[0]).toMatch(/^::error::/);
  });
});

describe("run use-d1", () => {
  it("writes the patched file for a valid id", () => {
    const h = harness({ D1_DATABASE_ID: REAL_ID });
    expect(run(["use-d1"], h.deps)).toBe(0);
    expect(h.written.w).toContain(REAL_ID);
  });

  it("errors with exit 1 and writes nothing for a bad or empty id", () => {
    for (const id of ["", "junk", ZERO_ID]) {
      const h = harness({ D1_DATABASE_ID: id });
      expect(run(["use-d1"], h.deps)).toBe(1);
      expect(h.out[0]).toMatch(/^::error::/);
      expect(h.written).toEqual({});
    }
  });
});
