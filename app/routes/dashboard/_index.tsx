import { useTranslation } from "react-i18next";
import { useOutletContext, Link } from "react-router";
import {
  IconShieldLock,
  IconLayoutDashboard,
  IconCloudUpload,
  IconAtom,
  IconArrowRight,
  IconSparkles,
  IconBook,
  IconBrandGithub,
} from "@tabler/icons-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StackBadge } from "@/components/stack-badge";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export const handle = { i18n: ["dashboard"] };

export default function DashboardIndex() {
  const { t } = useTranslation("dashboard");
  const { user } = useOutletContext<{ user: { name: string; role?: string | null } }>();
  const isAdmin = user.role === "admin";

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 lg:px-6">
      {/* Welcome */}
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <IconSparkles className="size-3" />
            {t("eyebrow")}
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("welcome", { name: user.name })}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button asChild variant="outline" size="sm" data-testid="dashboard-go-admin">
              <Link to="/admin">
                <IconLayoutDashboard className="size-4" />
                {t("actions.open_admin")}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" data-testid="dashboard-docs">
            <a href="https://github.com/" target="_blank" rel="noreferrer">
              <IconBook className="size-4" />
              {t("actions.docs")}
            </a>
          </Button>
          <LanguageSwitcher compact />
          <ThemeToggle />
        </div>
      </header>

      {/* Educational grid */}
      <section className="mb-12">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t("explore.title")}
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("explore.count")}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
          <ExploreCard
            icon={<IconShieldLock className="size-5" />}
            title={t("explore.cards.auth.title")}
            description={t("explore.cards.auth.description")}
            badges={["Better Auth", "D1"]}
            to="/admin/users"
            disabled={!isAdmin}
            disabledHint={t("explore.cards.auth.admin_only")}
            cta={t("explore.cards.auth.cta")}
            testId="dash-card-auth"
          />
          <ExploreCard
            icon={<IconLayoutDashboard className="size-5" />}
            title={t("explore.cards.admin.title")}
            description={t("explore.cards.admin.description")}
            badges={["tRPC", "Drizzle"]}
            to="/admin"
            disabled={!isAdmin}
            disabledHint={t("explore.cards.admin.admin_only")}
            cta={t("explore.cards.admin.cta")}
            testId="dash-card-admin"
          />
          <ExploreCard
            icon={<IconCloudUpload className="size-5" />}
            title={t("explore.cards.upload.title")}
            description={t("explore.cards.upload.description")}
            badges={["R2", "Workers"]}
            to="/admin/kitchen-sink"
            disabled={!isAdmin}
            disabledHint={t("explore.cards.upload.admin_only")}
            cta={t("explore.cards.upload.cta")}
            testId="dash-card-upload"
          />
          <ExploreCard
            icon={<IconAtom className="size-5" />}
            title={t("explore.cards.effect.title")}
            description={t("explore.cards.effect.description")}
            badges={["Effect TS", "Schema"]}
            to="/admin/kitchen-sink"
            disabled={!isAdmin}
            disabledHint={t("explore.cards.effect.admin_only")}
            cta={t("explore.cards.effect.cta")}
            testId="dash-card-effect"
          />
        </div>
      </section>

      {/* Status / your account */}
      <section>
        <Card data-testid="dashboard-account">
          <CardHeader className="gap-2">
            <CardTitle className="text-base">{t("account.title")}</CardTitle>
            <CardDescription>{t("account.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <StackBadge active>
                {isAdmin ? t("account.role_admin") : t("account.role_user")}
              </StackBadge>
              <StackBadge>{t("account.session_active")}</StackBadge>
            </div>
            <Button asChild variant="ghost" size="sm">
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="dashboard-source"
              >
                <IconBrandGithub className="size-4" />
                {t("account.source")}
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

interface ExploreCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badges: string[];
  to: string;
  cta: string;
  testId: string;
  disabled?: boolean;
  disabledHint?: string;
}

function ExploreCard({
  icon,
  title,
  description,
  badges,
  to,
  cta,
  testId,
  disabled = false,
  disabledHint,
}: ExploreCardProps) {
  const inner = (
    <Card
      data-testid={testId}
      className={
        disabled
          ? "h-full opacity-70"
          : "h-full transition-shadow hover:shadow-md"
      }
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
            <IconArrowRight className="size-3.5" />
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
