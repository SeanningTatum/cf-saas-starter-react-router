import { expect } from "@playwright/test";
import {
  MS_PER_SECOND,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMIT_REQUESTS_PER_PERIOD,
  msLeftInRateLimitWindow,
} from "../../app/lib/constants/rate-limit";
import { TIMEOUTS_MS } from "./values";

export interface RateLimitRule {
  readonly limit: number;
  readonly periodSeconds: number;
}

export const rateLimitFromWrangler = (
  rule: keyof typeof RATE_LIMIT_REQUESTS_PER_PERIOD,
): RateLimitRule => ({
  limit: RATE_LIMIT_REQUESTS_PER_PERIOD[rule],
  periodSeconds: RATE_LIMIT_PERIOD_SECONDS,
});

export const startEarlyInAFixedWindow = async (
  { periodSeconds }: RateLimitRule,
  marginSeconds: number,
) => {
  const periodMs = periodSeconds * MS_PER_SECOND;
  const leftAtStart = msLeftInRateLimitWindow(Date.now(), periodMs);
  if (leftAtStart >= marginSeconds * MS_PER_SECOND) return;
  await expect
    .poll(() => msLeftInRateLimitWindow(Date.now(), periodMs), {
      message: "the clock never reached the next rate-limit window",
      timeout: TIMEOUTS_MS.rateLimitWindowWait,
    })
    .toBeGreaterThan(leftAtStart);
};
