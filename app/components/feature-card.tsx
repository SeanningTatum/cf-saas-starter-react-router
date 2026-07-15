import type { ReactNode } from "react";
import { Link } from "react-router";
import { IconArrowRight } from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StackBadge } from "@/components/stack-badge";
import { cn } from "@/lib/utils";

export interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges: string[];
  to: string;
  cta: string;
  testId: string;
  /** Renders a non-interactive card showing `disabledHint` instead of the CTA/link. */
  disabled?: boolean;
  disabledHint?: string;
}

/**
 * Shared "feature/explore" card used on the marketing home page and the
 * dashboard's educational grid. Wraps a `Card` in a `Link` unless `disabled`,
 * in which case it renders inert with `disabledHint` in place of the CTA.
 */
export function FeatureCard({
  icon,
  title,
  description,
  badges,
  to,
  cta,
  testId,
  disabled = false,
  disabledHint,
}: FeatureCardProps) {
  const inner = (
    <Card
      data-testid={testId}
      className={cn(
        "h-full gap-4",
        disabled ? "opacity-70" : "transition-shadow hover:shadow-md"
      )}
    >
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <span className="flex size-9 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground">
            {icon}
          </span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {badges.map((b) => (
              <StackBadge key={b}>{b}</StackBadge>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="leading-relaxed">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {disabled && disabledHint ? (
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {disabledHint}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            {cta}
            <IconArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        )}
      </CardContent>
    </Card>
  );

  if (disabled) return inner;
  return (
    <Link to={to} className="group">
      {inner}
    </Link>
  );
}
