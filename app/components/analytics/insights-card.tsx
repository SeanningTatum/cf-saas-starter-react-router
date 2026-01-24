import { Lightbulb } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface Insight {
  /** The insight text */
  text: string;
  /** Type affects styling: positive (green), negative (red), neutral (default) */
  type?: "positive" | "negative" | "neutral";
}

export interface InsightsCardProps {
  /** Card title */
  title?: string;
  /** Card description */
  description?: string;
  /** Array of insights to display */
  insights: Insight[];
}

export function InsightsCard({
  title = "Insights",
  description,
  insights,
}: InsightsCardProps) {
  const getInsightStyle = (type: Insight["type"]) => {
    switch (type) {
      case "positive":
        return "text-green-600 dark:text-green-400";
      case "negative":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="size-5" />
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ul className="space-y-3 text-sm">
          {insights.map((insight, index) => (
            <li
              key={index}
              className={`flex items-center gap-3 ${getInsightStyle(insight.type)}`}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-current" />
              <span className="leading-relaxed">{insight.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
