import { cn } from "@/lib/utils";

interface StackBadgeProps {
  children: React.ReactNode;
  className?: string;
  /** When true, render the leading dot in the accent color. Defaults to false (muted). */
  active?: boolean;
}

/**
 * Small monospace label naming a stack piece (e.g. "Workers", "tRPC").
 * See `.brain/codebase/design-system.md` for usage rationale.
 */
export function StackBadge({ children, className, active = false }: StackBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-primary" : "bg-muted-foreground/40",
        )}
      />
      {children}
    </span>
  );
}
