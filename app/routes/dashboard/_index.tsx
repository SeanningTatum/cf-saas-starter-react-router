import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { useOutletContext } from "react-router";
import { Rocket, Activity, Zap } from "lucide-react";

export const handle = { i18n: ["dashboard"] };

export default function DashboardIndex() {
  const { t } = useTranslation("dashboard");
  const { user } = useOutletContext<{ user: { name: string } }>();

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 lg:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("welcome", { name: user.name })}
        </h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("cards.getting_started.title")}
              </CardTitle>
            </div>
            <CardDescription>
              {t("cards.getting_started.description")}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("cards.recent_activity.title")}
              </CardTitle>
            </div>
            <CardDescription>
              {t("cards.recent_activity.description")}
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                {t("cards.quick_actions.title")}
              </CardTitle>
            </div>
            <CardDescription>
              {t("cards.quick_actions.description")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
