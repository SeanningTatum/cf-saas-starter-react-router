import { SiteHeader } from "./layout/site-header";
import {
  StatCard,
  StatCardGrid,
  TimeSeriesChart,
  DistributionChart,
  InsightsCard,
  type Insight,
} from "@/components/analytics";
import { Users, ShieldCheck, UserX, Shield } from "lucide-react";
import type { Route } from "./+types/_index";
import { useTranslation } from "react-i18next";

export const handle = { i18n: ["admin"] };

export const loader = async ({ context }: Route.LoaderArgs) => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  const [stats, growthData, roleDistribution, verificationDistribution] =
    await Promise.all([
      context.trpc.analytics.getUserStats(),
      context.trpc.analytics.getUserGrowth({ startDate, endDate }),
      context.trpc.analytics.getRoleDistribution(),
      context.trpc.analytics.getVerificationDistribution(),
    ]);

  return { stats, growthData, roleDistribution, verificationDistribution };
};

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  if (!loaderData) {
    return (
      <div>
        <SiteHeader title={t("dashboard.title")} />
        <div className="flex items-center justify-center p-12">
          <div className="text-muted-foreground">{tc("loading")}</div>
        </div>
      </div>
    );
  }

  const { stats, growthData, roleDistribution, verificationDistribution } =
    loaderData;

  const insights: Insight[] = [];

  if (stats.verificationRate >= 80) {
    insights.push({
      text: t("insights.verification_excellent", { rate: stats.verificationRate }),
      type: "positive",
    });
  } else if (stats.verificationRate >= 50) {
    insights.push({
      text: t("insights.verification_moderate", { rate: stats.verificationRate }),
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
      text: t("insights.banned_users", { count: stats.bannedUsers, percent: bannedPercent }),
      type: bannedPercent > 5 ? "negative" : "neutral",
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
    const recentSignups = growthData.slice(-7).reduce((sum, d) => sum + d.count, 0);
    insights.push({
      text: t("insights.recent_signups", { count: recentSignups }),
      type: recentSignups > 0 ? "positive" : "neutral",
    });
  }

  return (
    <div>
      <SiteHeader title={t("dashboard.title")} />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {/* Stats Cards */}
            <div className="px-4 lg:px-6">
              <StatCardGrid columns={4}>
                <StatCard
                  label={t("dashboard.total_users")}
                  value={stats.totalUsers}
                  icon={Users}
                  description={t("dashboard.total_users_description")}
                />
                <StatCard
                  label={t("dashboard.verified_users")}
                  value={stats.verifiedUsers}
                  icon={ShieldCheck}
                  description={t("dashboard.verified_users_description", { rate: stats.verificationRate })}
                />
                <StatCard
                  label={t("dashboard.admins")}
                  value={stats.adminUsers}
                  icon={Shield}
                  description={t("dashboard.admins_description")}
                />
                <StatCard
                  label={t("dashboard.banned_users")}
                  value={stats.bannedUsers}
                  icon={UserX}
                  description={t("dashboard.banned_users_description")}
                />
              </StatCardGrid>
            </div>

            {/* Charts Row */}
            <div className="px-4 lg:px-6">
              <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
                <TimeSeriesChart
                  title={t("charts.user_growth")}
                  description={t("charts.user_growth_description")}
                  data={growthData}
                  dataKey="count"
                  dataLabel={t("charts.new_users")}
                  type="area"
                  showTimeRangeSelector
                />
                <DistributionChart
                  title={t("charts.user_roles")}
                  description={t("charts.user_roles_description")}
                  data={roleDistribution}
                  type="donut"
                />
              </div>
            </div>

            {/* Second Row: Verification Distribution + Insights */}
            <div className="px-4 lg:px-6">
              <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
                <DistributionChart
                  title={t("charts.email_verification")}
                  description={t("charts.email_verification_description")}
                  data={verificationDistribution}
                  type="donut"
                  colors={["var(--chart-2)", "var(--chart-4)"]}
                />
                <InsightsCard
                  title={t("insights.title")}
                  description={t("insights.description")}
                  insights={insights}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
