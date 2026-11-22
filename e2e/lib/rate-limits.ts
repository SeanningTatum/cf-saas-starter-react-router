import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { Schema } from "effect";
import { RATE_LIMIT_BINDINGS } from "../../app/lib/constants/rate-limit";
import { JSONC_LINE_COMMENT, MS_PER_SECOND, TIMEOUTS_MS, WRANGLER_CONFIG_FILE } from "./values";

const WranglerRateLimits = Schema.Struct({
  ratelimits: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      simple: Schema.Struct({ limit: Schema.Number, period: Schema.Number }),
    }),
  ),
});

export interface RateLimitRule {
  readonly limit: number;
  readonly periodSeconds: number;
}

export const rateLimitFromWrangler = (rule: keyof typeof RATE_LIMIT_BINDINGS): RateLimitRule => {
  const configFile = test.info().config.configFile;
  expect(configFile, "no playwright config file to find wrangler.jsonc beside").toBeTruthy();
  const wranglerPath = path.join(path.dirname(configFile ?? ""), WRANGLER_CONFIG_FILE);
  const config = Schema.decodeUnknownSync(WranglerRateLimits)(
    JSON.parse(readFileSync(wranglerPath, "utf8").replace(JSONC_LINE_COMMENT, "")),
  );
  const binding = RATE_LIMIT_BINDINGS[rule];
  const entry = config.ratelimits.find(({ name }) => name === binding);
  expect(entry, `${WRANGLER_CONFIG_FILE} has no top-level ratelimits entry named ${binding}`).toBeDefined();
  return { limit: entry?.simple.limit ?? 0, periodSeconds: entry?.simple.period ?? 0 };
};

const secondsLeftInWindow = (periodSeconds: number) =>
  periodSeconds - ((Date.now() / MS_PER_SECOND) % periodSeconds);

export const startEarlyInAFixedWindow = async ({ periodSeconds }: RateLimitRule, marginSeconds: number) => {
  if (secondsLeftInWindow(periodSeconds) >= marginSeconds) return;
  const windowOf = () => Math.floor(Date.now() / MS_PER_SECOND / periodSeconds);
  const current = windowOf();
  await expect
    .poll(windowOf, {
      message: "the clock never reached the next rate-limit window",
      timeout: TIMEOUTS_MS.rateLimitWindowWait,
    })
    .toBeGreaterThan(current);
};
