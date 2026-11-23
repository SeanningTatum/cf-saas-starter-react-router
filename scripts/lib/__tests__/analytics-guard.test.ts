import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { afterEach, describe, expect } from "vitest";
import { providerSetIn, refuseRealAnalytics } from "../analytics-guard";

const roots: string[] = [];

const rootWith = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "analytics-guard-"));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("providerSetIn", () => {
  it("reads a bare, a quoted and an export-prefixed value, as dotenv does, so neither quoting nor export can hide posthog", () => {
    expect(providerSetIn("ANALYTICS_PROVIDER=posthog\n")).toBe("posthog");
    expect(providerSetIn('ANALYTICS_PROVIDER="posthog"\n')).toBe("posthog");
    expect(providerSetIn("  ANALYTICS_PROVIDER = 'posthog' # real\n")).toBe("posthog");
    expect(providerSetIn("export ANALYTICS_PROVIDER=posthog\n")).toBe("posthog");
  });

  it("skips a commented-out line, so the .dev.vars.example hint does not stop every run", () => {
    expect(providerSetIn("# ANALYTICS_PROVIDER=posthog\nOTHER=1\n")).toBeUndefined();
  });

  it("takes the last assignment, as dotenv does, so a later console overrides an earlier posthog and the reverse", () => {
    expect(providerSetIn("ANALYTICS_PROVIDER=posthog\nANALYTICS_PROVIDER=console\n")).toBe("console");
    expect(providerSetIn("ANALYTICS_PROVIDER=console\nANALYTICS_PROVIDER=posthog\n")).toBe("posthog");
  });

  it("does not match a longer key, so POSTHOG settings alone do not stop the run", () => {
    expect(providerSetIn("MY_ANALYTICS_PROVIDER=posthog\nPOSTHOG_API_KEY=k\n")).toBeUndefined();
  });
});

describe("refuseRealAnalytics", () => {
  it.effect("passes with no env file and with console, so a fresh checkout and the console adapter run", () =>
    Effect.gen(function* () {
      yield* refuseRealAnalytics(rootWith({}));
      yield* refuseRealAnalytics(rootWith({ ".dev.vars": "ANALYTICS_PROVIDER=console\n" }));
    }),
  );

  it.effect("fails naming the file when .dev.vars sets posthog, so e2e never sends real events", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(refuseRealAnalytics(rootWith({ ".dev.vars": 'ANALYTICS_PROVIDER="posthog"\n' })));
      expect(Either.isLeft(result) && result.left._tag).toBe("RealAnalyticsProviderError");
      expect(Either.isLeft(result) && result.left.file).toBe(".dev.vars");
    }),
  );

  it.effect("checks .env even when .dev.vars exists without the key, so the second file cannot slip past", () =>
    Effect.gen(function* () {
      const root = rootWith({ ".dev.vars": "OTHER=1\n", ".env": "ANALYTICS_PROVIDER=posthog\n" });
      const result = yield* Effect.either(refuseRealAnalytics(root));
      expect(Either.isLeft(result) && result.left.file).toBe(".env");
    }),
  );

  it.effect("fails closed when an env file cannot be read, so an unreadable file is not taken as analytics off", () =>
    Effect.gen(function* () {
      const root = rootWith({});
      fs.mkdirSync(path.join(root, ".dev.vars"));
      const result = yield* Effect.either(refuseRealAnalytics(root));
      expect(Either.isLeft(result) && result.left.provider).toBe("unknown");
    }),
  );
});
