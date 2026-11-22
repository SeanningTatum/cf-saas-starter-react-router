import type { Insight } from "@/components/analytics/insights-card";
import type { UserStats, UserGrowthPoint } from "@/lib/schemas/analytics";
import {
  BANNED_PERCENT_HIGH_THRESHOLD,
  RECENT_SIGNUPS_WINDOW_DAYS,
  VERIFICATION_RATE_EXCELLENT_THRESHOLD,
  VERIFICATION_RATE_MODERATE_THRESHOLD,
} from "@/lib/constants/insights";

export {
  BANNED_PERCENT_HIGH_THRESHOLD,
  VERIFICATION_RATE_EXCELLENT_THRESHOLD,
  VERIFICATION_RATE_MODERATE_THRESHOLD,
};

export type InsightsTranslator = (
  key: string,
  options?: Record<string, unknown>
) => string;

export function buildUserInsights(
  stats: UserStats,
  growthData: readonly UserGrowthPoint[],
  t: InsightsTranslator
): Insight[] {
  const insights: Insight[] = [];

  if (stats.verificationRate >= VERIFICATION_RATE_EXCELLENT_THRESHOLD) {
    insights.push({
      text: t("insights.verification_excellent", {
        rate: stats.verificationRate,
      }),
      type: "positive",
    });
  } else if (stats.verificationRate >= VERIFICATION_RATE_MODERATE_THRESHOLD) {
    insights.push({
      text: t("insights.verification_moderate", {
        rate: stats.verificationRate,
      }),
      type: "neutral",
    });
  } else {
    insights.push({
      text: t("insights.verification_low", { rate: stats.verificationRate }),
      type: "negative",
    });
  }

  if (stats.bannedUsers > 0) {
    const bannedPercent = Math.round(
      (stats.bannedUsers / stats.totalUsers) * 100
    );
    insights.push({
      text: t("insights.banned_users", {
        count: stats.bannedUsers,
        percent: bannedPercent,
      }),
      type: bannedPercent > BANNED_PERCENT_HIGH_THRESHOLD ? "negative" : "neutral",
    });
  } else {
    insights.push({
      text: t("insights.no_banned"),
      type: "positive",
    });
  }

  if (stats.adminUsers > 0) {
    insights.push({
      text: t("insights.admins_managing", { count: stats.adminUsers }),
      type: "neutral",
    });
  }

  if (growthData.length > 0) {
    const recentSignups = growthData
      .slice(-RECENT_SIGNUPS_WINDOW_DAYS)
      .reduce((sum, d) => sum + d.count, 0);
    insights.push({
      text: t("insights.recent_signups", { count: recentSignups }),
      type: recentSignups > 0 ? "positive" : "neutral",
    });
  }

  return insights;
}
