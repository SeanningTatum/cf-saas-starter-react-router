import type { Route } from "./+types/home";
import { Link, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import {
  IconBrandGithub,
  IconShieldLock,
  IconLayoutDashboard,
  IconCloudUpload,
  IconChartBar,
  IconLanguage,
  IconAtom,
  IconArrowRight,
  IconBook,
  IconBrain,
  IconChecklist,
  IconRoute,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StackBadge } from "@/components/stack-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

export const handle = { i18n: ["home"] };

const STACK = [
  "Workers",
  "React Router",
  "tRPC",
  "Better Auth",
  "Drizzle",
  "Effect TS",
] as const;

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Cloudflare SaaS Starter" },
    {
      name: "description",
      content:
        "Production-ready full-stack TypeScript starter — Cloudflare Workers, React Router v7, tRPC, Better Auth, Drizzle, and Effect TS.",
    },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({ headers: request.headers });
  if (session) return redirect("/dashboard");
  return null;
}

export default function Home() {
  const { t } = useTranslation("home");

  return (
    <div className="min-h-svh bg-background">
      <TopBar />

      <main className="mx-auto max-w-6xl px-6 pb-24">
        {/* Hero */}
        <section className="flex flex-col items-start gap-8 pt-20 pb-16 md:items-center md:text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            {t("hero.eyebrow")}
          </span>

          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            {t("hero.title_lead")}{" "}
            <span className="text-primary">{t("hero.title_accent")}</span>
            {t("hero.title_trail")}
          </h1>

          <p className="max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
            {t("hero.description")}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" data-testid="hero-sign-up">
              <Link to="/sign-up">
                {t("hero.cta_primary")}
                <IconArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" data-testid="hero-sign-in">
              <Link to="/login">{t("hero.cta_secondary")}</Link>
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 md:justify-center">
            {STACK.map((label) => (
              <StackBadge key={label}>{label}</StackBadge>
            ))}
          </div>
        </section>

        {/* What's wired */}
        <section className="border-t border-border pt-16">
          <div className="mb-8 flex flex-col gap-2">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("wired.title")}
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("wired.subtitle")}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<IconShieldLock className="size-5" />}
              title={t("wired.cards.auth.title")}
              description={t("wired.cards.auth.description")}
              badges={["Better Auth", "D1"]}
              to="/login"
              cta={t("wired.cards.auth.cta")}
              testId="card-auth"
            />
            <FeatureCard
              icon={<IconLayoutDashboard className="size-5" />}
              title={t("wired.cards.admin.title")}
              description={t("wired.cards.admin.description")}
              badges={["tRPC", "Drizzle"]}
              to="/admin"
              cta={t("wired.cards.admin.cta")}
              testId="card-admin"
            />
            <FeatureCard
              icon={<IconCloudUpload className="size-5" />}
              title={t("wired.cards.upload.title")}
              description={t("wired.cards.upload.description")}
              badges={["R2", "Workers"]}
              to="/dashboard"
              cta={t("wired.cards.upload.cta")}
              testId="card-upload"
            />
            <FeatureCard
              icon={<IconChartBar className="size-5" />}
              title={t("wired.cards.analytics.title")}
              description={t("wired.cards.analytics.description")}
              badges={["tRPC", "Drizzle"]}
              to="/admin"
              cta={t("wired.cards.analytics.cta")}
              testId="card-analytics"
            />
            <FeatureCard
              icon={<IconAtom className="size-5" />}
              title={t("wired.cards.effect.title")}
              description={t("wired.cards.effect.description")}
              badges={["Effect TS", "Schema"]}
              to="/admin/kitchen-sink"
              cta={t("wired.cards.effect.cta")}
              testId="card-effect"
            />
            <FeatureCard
              icon={<IconLanguage className="size-5" />}
              title={t("wired.cards.i18n.title")}
              description={t("wired.cards.i18n.description")}
              badges={["remix-i18next"]}
              to="/dashboard"
              cta={t("wired.cards.i18n.cta")}
              testId="card-i18n"
            />
          </div>
        </section>

        {/* Harness */}
        <section className="mt-20 border-t border-border pt-16">
          <div className="mb-8 flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />
              {t("harness.eyebrow")}
            </span>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {t("harness.title")}
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("harness.subtitle")}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <HarnessPillar
              icon={<IconBrain className="size-5" />}
              title={t("harness.pillars.brain.title")}
              description={t("harness.pillars.brain.description")}
              path=".brain/"
            />
            <HarnessPillar
              icon={<IconRoute className="size-5" />}
              title={t("harness.pillars.recipes.title")}
              description={t("harness.pillars.recipes.description")}
              path=".brain/recipes/"
            />
            <HarnessPillar
              icon={<IconChecklist className="size-5" />}
              title={t("harness.pillars.gates.title")}
              description={t("harness.pillars.gates.description")}
              path="/verify-done"
            />
          </div>

          <div className="mt-6 overflow-hidden rounded-md border border-border bg-card">
            <div className="border-b border-border bg-muted/40 px-4 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("harness.commands_label")}
              </span>
            </div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-sm leading-relaxed text-foreground">
              <code>{`# kickoff a task — runs baseline, reads brain, opens run note
/start-task "add billing endpoint"

# verify before declaring done — typecheck, test, e2e, brain coherence
/verify-done

# close out a feature — flips feature_list.json + harness-check
/ship-feature`}</code>
            </pre>
          </div>
        </section>

        {/* Quickstart */}
        <section className="mt-20 border-t border-border pt-16">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {t("quickstart.title")}
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                {t("quickstart.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" data-testid="quickstart-github">
                <a
                  href="https://github.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconBrandGithub className="size-4" />
                  {t("quickstart.repo")}
                </a>
              </Button>
              <Button asChild variant="outline" data-testid="quickstart-docs">
                <a href="/admin/kitchen-sink">
                  <IconBook className="size-4" />
                  {t("quickstart.docs")}
                </a>
              </Button>
            </div>
          </div>

          <div className="mt-8 overflow-hidden rounded-md border border-border bg-card">
            <div className="border-b border-border bg-muted/40 px-4 py-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("quickstart.terminal")}
              </span>
            </div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-sm leading-relaxed text-foreground">
              <code>{`# 1. install
bun install

# 2. apply local D1 migrations
bun run db:migrate:local

# 3. run dev server
bun run dev`}</code>
            </pre>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function TopBar() {
  const { t } = useTranslation("home");

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link
          to="/"
          className="flex items-center gap-2 font-medium"
          data-testid="brand-link"
        >
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-[10px] font-bold">
            CF
          </span>
          <span className="text-sm">{t("brand")}</span>
        </Link>
        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            <a
              href="https://github.com/"
              target="_blank"
              rel="noreferrer"
              data-testid="topbar-github"
            >
              <IconBrandGithub className="size-4" />
              GitHub
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm" data-testid="topbar-sign-in">
            <Link to="/login">{t("topbar.sign_in")}</Link>
          </Button>
          <Button asChild size="sm" data-testid="topbar-sign-up">
            <Link to="/sign-up">{t("topbar.sign_up")}</Link>
          </Button>
          <LanguageSwitcher compact />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  badges: string[];
  to: string;
  cta: string;
  testId: string;
}

function FeatureCard({
  icon,
  title,
  description,
  badges,
  to,
  cta,
  testId,
}: FeatureCardProps) {
  return (
    <Link to={to} data-testid={testId} className="group">
      <Card className="h-full gap-4 transition-shadow hover:shadow-md">
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
          <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            {cta}
            <IconArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

interface HarnessPillarProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  path: string;
}

function HarnessPillar({ icon, title, description, path }: HarnessPillarProps) {
  return (
    <Card className="h-full">
      <CardHeader className="gap-3">
        <span className="flex size-9 items-center justify-center rounded-md border border-border bg-muted/40 text-foreground">
          {icon}
        </span>
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="leading-relaxed">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {path}
        </span>
      </CardContent>
    </Card>
  );
}

function Footer() {
  const { t } = useTranslation("home");

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t("footer.tagline")}</p>
        <p className="font-mono text-xs uppercase tracking-wider">
          {STACK.join(" · ")}
        </p>
      </div>
    </footer>
  );
}
