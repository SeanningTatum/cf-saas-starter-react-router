import { useState } from "react";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  ListChecks,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "@/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const directionIcon = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

const directionStyle = {
  up: "text-green-600 dark:text-green-400",
  down: "text-red-600 dark:text-red-400",
  flat: "text-muted-foreground",
} as const;

/**
 * On-demand AI insights for the admin dashboard. The deterministic
 * `InsightsCard` covers always-on observations; this card calls the
 * `analytics.getAiInsights` mutation (Workers AI, paid inference) only when
 * the admin asks for it — never on page load.
 */
export function AiInsightsCard() {
  const { t } = useTranslation("admin");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mutation = api.analytics.getAiInsights.useMutation({
    onError: () => setErrorMessage(t("ai_insights.error")),
    onSuccess: () => setErrorMessage(null),
  });
  const result = mutation.data;

  return (
    <Card data-testid="ai-insights-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5" />
              {t("ai_insights.title")}
            </CardTitle>
            <CardDescription>{t("ai_insights.description")}</CardDescription>
          </div>
          <Button
            size="sm"
            variant={result ? "outline" : "default"}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            data-testid="ai-insights-generate"
          >
            {mutation.isPending
              ? t("ai_insights.generating")
              : result
                ? t("ai_insights.regenerate")
                : t("ai_insights.generate")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {errorMessage && (
          <p
            className="text-sm text-red-600 dark:text-red-400"
            data-testid="ai-insights-error"
          >
            {errorMessage}
          </p>
        )}
        {!result && !errorMessage && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="ai-insights-empty"
          >
            {t("ai_insights.empty")}
          </p>
        )}
        {result && (
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <p
                className="text-sm font-medium leading-relaxed"
                data-testid="ai-insights-headline"
              >
                {result.headline}
              </p>
              {result.dataQuality === "sparse" && (
                <Badge
                  variant="secondary"
                  className="shrink-0"
                  data-testid="ai-insights-sparse-badge"
                >
                  {t("ai_insights.sparse_data")}
                </Badge>
              )}
            </div>
            <ul className="space-y-2 text-sm" data-testid="ai-insights-trends">
              {result.trends.map((trend, index) => {
                const Icon = directionIcon[trend.direction];
                return (
                  <li key={index} className="flex items-start gap-2">
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        directionStyle[trend.direction]
                      )}
                    />
                    <span className="leading-relaxed">
                      <span className="font-medium">{trend.label}:</span>{" "}
                      <span className="text-muted-foreground">
                        {trend.detail}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-2 border-t pt-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ListChecks className="size-4" />
                {t("ai_insights.suggested_actions")}
              </p>
              <ul
                className="space-y-1.5 text-sm text-muted-foreground"
                data-testid="ai-insights-actions"
              >
                {result.suggestedActions.map((action, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" />
                    <span className="leading-relaxed">{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
