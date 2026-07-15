import { describe, it, expect } from "vitest";
import {
  buildUserInsights,
  VERIFICATION_RATE_EXCELLENT_THRESHOLD,
  VERIFICATION_RATE_MODERATE_THRESHOLD,
  BANNED_PERCENT_HIGH_THRESHOLD,
} from "../insights";
import type { UserStats, UserGrowthPoint } from "@/lib/schemas/analytics";

// Stub translator — returns the key so assertions can pin down which copy fired.
const t = (key: string) => key;

const baseStats: UserStats = {
  totalUsers: 100,
  verifiedUsers: 0,
  bannedUsers: 0,
  adminUsers: 0,
  verificationRate: 0,
};

describe("buildUserInsights", () => {
  it("reports 'excellent' verification at/above the excellent threshold", () => {
    const insights = buildUserInsights(
      { ...baseStats, verificationRate: VERIFICATION_RATE_EXCELLENT_THRESHOLD },
      [],
      t
    );
    expect(insights[0]).toEqual({
      text: "insights.verification_excellent",
      type: "positive",
    });
  });

  it("reports 'moderate' verification between the two thresholds", () => {
    const insights = buildUserInsights(
      { ...baseStats, verificationRate: VERIFICATION_RATE_MODERATE_THRESHOLD },
      [],
      t
    );
    expect(insights[0]).toEqual({
      text: "insights.verification_moderate",
      type: "neutral",
    });
  });

  it("reports 'low' verification below the moderate threshold", () => {
    const insights = buildUserInsights(
      { ...baseStats, verificationRate: VERIFICATION_RATE_MODERATE_THRESHOLD - 1 },
      [],
      t
    );
    expect(insights[0]).toEqual({
      text: "insights.verification_low",
      type: "negative",
    });
  });

  it("reports 'no banned users' as positive when none are banned", () => {
    const insights = buildUserInsights(baseStats, [], t);
    expect(insights).toContainEqual({
      text: "insights.no_banned",
      type: "positive",
    });
  });

  it("reports banned users as neutral at/below the high threshold", () => {
    // 5/100 = 5% == BANNED_PERCENT_HIGH_THRESHOLD, not > threshold
    const insights = buildUserInsights(
      { ...baseStats, bannedUsers: BANNED_PERCENT_HIGH_THRESHOLD },
      [],
      t
    );
    expect(insights).toContainEqual({
      text: "insights.banned_users",
      type: "neutral",
    });
  });

  it("reports banned users as negative above the high threshold", () => {
    // 10/100 = 10% > BANNED_PERCENT_HIGH_THRESHOLD
    const insights = buildUserInsights(
      { ...baseStats, bannedUsers: 10 },
      [],
      t
    );
    expect(insights).toContainEqual({
      text: "insights.banned_users",
      type: "negative",
    });
  });

  it("adds an admins-managing insight when there are admins", () => {
    const insights = buildUserInsights({ ...baseStats, adminUsers: 2 }, [], t);
    expect(insights).toContainEqual({
      text: "insights.admins_managing",
      type: "neutral",
    });
  });

  it("omits the admins insight when there are no admins", () => {
    const insights = buildUserInsights(baseStats, [], t);
    expect(
      insights.some((i) => i.text === "insights.admins_managing")
    ).toBe(false);
  });

  it("omits the recent-signups insight when growthData is empty", () => {
    const insights = buildUserInsights(baseStats, [], t);
    expect(
      insights.some((i) => i.text === "insights.recent_signups")
    ).toBe(false);
  });

  it("sums only the trailing 7-day window for recent signups", () => {
    const growthData: UserGrowthPoint[] = Array.from(
      { length: 10 },
      (_, i) => ({ date: `2026-01-${i + 1}`, count: 1 })
    );
    const insights = buildUserInsights(baseStats, growthData, t);
    const recent = insights.find((i) => i.text === "insights.recent_signups");
    expect(recent).toEqual({ text: "insights.recent_signups", type: "positive" });
  });

  it("marks recent signups as neutral when the trailing window sums to zero", () => {
    const growthData: UserGrowthPoint[] = [{ date: "2026-01-01", count: 0 }];
    const insights = buildUserInsights(baseStats, growthData, t);
    expect(insights).toContainEqual({
      text: "insights.recent_signups",
      type: "neutral",
    });
  });
});
