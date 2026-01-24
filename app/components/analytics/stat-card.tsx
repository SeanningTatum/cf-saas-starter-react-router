import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface StatCardProps {
  /** Label shown above the value */
  label: string;
  /** The main value to display */
  value: string | number;
  /** Percentage change (positive or negative) */
  change?: number;
  /** Description shown in footer */
  description?: string;
  /** Secondary description shown below the main description */
  secondaryDescription?: string;
  /** Optional icon component */
  icon?: LucideIcon;
}

export function StatCard({
  label,
  value,
  change,
  description,
  secondaryDescription,
  icon: Icon,
}: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;
  const TrendIcon = isPositive ? IconTrendingUp : IconTrendingDown;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          {Icon && <Icon className="size-4" />}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {typeof value === "number" ? value.toLocaleString() : value}
        </CardTitle>
        {change !== undefined && (
          <CardAction>
            <Badge variant="outline">
              <TrendIcon />
              {isPositive ? "+" : ""}
              {change}%
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      {(description || secondaryDescription) && (
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          {description && (
            <div className="line-clamp-1 flex gap-2 font-medium">
              {description}
              {change !== undefined && <TrendIcon className="size-4" />}
            </div>
          )}
          {secondaryDescription && (
            <div className="text-muted-foreground">{secondaryDescription}</div>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

export interface StatCardGridProps {
  children: React.ReactNode;
  /** Number of columns on large screens (default: 4) */
  columns?: 2 | 3 | 4;
}

export function StatCardGrid({ children, columns = 4 }: StatCardGridProps) {
  const colsClass = {
    2: "@5xl/main:grid-cols-2",
    3: "@5xl/main:grid-cols-3",
    4: "@5xl/main:grid-cols-4",
  }[columns];

  return (
    <div
      className={`*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 ${colsClass}`}
    >
      {children}
    </div>
  );
}
