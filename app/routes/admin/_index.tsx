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
  // Handle loading state during client navigation
  if (!loaderData) {
    return (
      <div>
        <SiteHeader title="Dashboard" />
        <div className="flex items-center justify-center p-12">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  const { stats, growthData, roleDistribution, verificationDistribution } =
    loaderData;

  // Generate insights based on the data
  const insights: Insight[] = [];

  if (stats.verificationRate >= 80) {
    insights.push({
      text: `${stats.verificationRate}% email verification rate - excellent user engagement`,
      type: "positive",
    });
  } else if (stats.verificationRate >= 50) {
    insights.push({
      text: `${stats.verificationRate}% email verification rate - room for improvement`,
      type: "neutral",
    });
  } else {
    insights.push({
      text: `${stats.verificationRate}% email verification rate - consider improving onboarding flow`,
      type: "negative",
    });
  }

  if (stats.bannedUsers > 0) {
    const bannedPercent = Math.round(
      (stats.bannedUsers / stats.totalUsers) * 100
    );
    insights.push({
      text: `${stats.bannedUsers} banned user${stats.bannedUsers > 1 ? "s" : ""} (${bannedPercent}% of total)`,
      type: bannedPercent > 5 ? "negative" : "neutral",
    });
  } else {
    insights.push({
      text: "No banned users - healthy community",
      type: "positive",
    });
  }

  if (stats.adminUsers > 0) {
    insights.push({
      text: `${stats.adminUsers} admin${stats.adminUsers > 1 ? "s" : ""} managing the platform`,
      type: "neutral",
    });
  }

  if (growthData.length > 0) {
    const recentSignups = growthData.slice(-7).reduce((sum, d) => sum + d.count, 0);
    insights.push({
      text: `${recentSignups} new user${recentSignups !== 1 ? "s" : ""} in the last 7 days`,
      type: recentSignups > 0 ? "positive" : "neutral",
    });
  }

  return (
    <div>
      <SiteHeader title="Dashboard" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            {/* Stats Cards */}
            <div className="px-4 lg:px-6">
              <StatCardGrid columns={4}>
                <StatCard
                  label="Total Users"
                  value={stats.totalUsers}
                  icon={Users}
                  description="All registered accounts"
                />
                <StatCard
                  label="Verified Users"
                  value={stats.verifiedUsers}
                  icon={ShieldCheck}
                  description={`${stats.verificationRate}% verification rate`}
                />
                <StatCard
                  label="Admins"
                  value={stats.adminUsers}
                  icon={Shield}
                  description="Platform administrators"
                />
                <StatCard
                  label="Banned Users"
                  value={stats.bannedUsers}
                  icon={UserX}
                  description="Restricted accounts"
                />
              </StatCardGrid>
            </div>

            {/* Charts Row */}
            <div className="px-4 lg:px-6">
              <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
                <TimeSeriesChart
                  title="User Growth"
                  description="New signups over time"
                  data={growthData}
                  dataKey="count"
                  dataLabel="New Users"
                  type="area"
                  showTimeRangeSelector
                />
                <DistributionChart
                  title="User Roles"
                  description="Distribution by role"
                  data={roleDistribution}
                  type="donut"
                />
              </div>
            </div>

            {/* Second Row: Verification Distribution + Insights */}
            <div className="px-4 lg:px-6">
              <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
                <DistributionChart
                  title="Email Verification"
                  description="Verified vs unverified users"
                  data={verificationDistribution}
                  type="donut"
                  colors={["var(--chart-2)", "var(--chart-4)"]}
                />
                <InsightsCard
                  title="Platform Insights"
                  description="Key observations about your user base"
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
