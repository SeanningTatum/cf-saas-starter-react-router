import type { Insight } from "@/components/analytics";
import type { UserStats, UserGrowthPoint } from "@/lib/schemas/analytics";

/** Translator shape needed to build insight copy — matches `useTranslation("admin").t`. */
export type InsightsTranslator = (
  key: string,
  options?: Record<string, unknown>
) => string;

/** Verification rate (%) at or above which the verification insight reads as "positive". */
export const VERIFICATION_RATE_EXCELLENT_THRESHOLD = 80;
/** Verification rate (%) at or above which the verification insight reads as "neutral" (below this, "negative"). */
export const VERIFICATION_RATE_MODERATE_THRESHOLD = 50;
/** Banned-user share (%) above which the banned-users insight reads as "negative" instead of "neutral". */
export const BANNED_PERCENT_HIGH_THRESHOLD = 5;
/** Trailing window (days) used to sum "recent signups" from the growth series. */
export const RECENT_SIGNUPS_WINDOW_DAYS = 7;

/**
 * Derives the admin dashboard's insight list from user stats + growth series.
 * Pure function — no i18n/formatting side effects beyond calling `t`.
 */
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
