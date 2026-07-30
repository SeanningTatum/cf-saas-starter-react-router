import type { Route } from "./+types/_index";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  IconArrowLeft,
  IconArrowRight,
  IconClockExclamation,
  IconFileInvoice,
  IconLayoutList,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { cn } from "@/lib/utils";
import {
  BOARD_ROWS,
  STATUS_DOT,
  boardFilters,
  isStaleCheckCall,
  type BoardRow,
} from "./board-data";

export const handle = { i18n: ["demo"] };

/**
 * Sample marketing surface for a fictional freight-dispatch SaaS ("Loadline").
 *
 * Reference-locked to Orderful (refero style 9c657624) — alternating neutral/white section
 * bands, a dark framed product-UI panel as the hero's evidence, and a single accent reserved
 * for the primary CTA. Full decision ledger, including what was deliberately rejected:
 * `.brain/features/sample-saas-landing/sample-saas-landing.md`.
 *
 * Everything here is expressed with existing `app/app.css` semantic tokens — the board's dark
 * frame is an inverted surface (`bg-foreground`/`text-background`) rather than a literal dark
 * colour, so it flips correctly in dark mode.
 */
export function meta(_: Route.MetaArgs) {
  return [
    { title: "Loadline — dispatch, check-calls and invoicing on one board" },
    {
      name: "description",
      content:
        "Sample SaaS marketing surface built inside the Cloudflare SaaS Starter, demonstrating the design pipeline on a fictional freight dispatch product.",
    },
  ];
}

export default function DemoLanding() {
  return (
    <div className="min-h-svh bg-background">
      <TopBar />
      <main>
        <Hero />
        <CostBand />
        <FeatureBand feature="board" icon={<IconLayoutList className="size-5" />} />
        <FeatureBand
          feature="invoicing"
          icon={<IconFileInvoice className="size-5" />}
          reversed
        />
        <NextBand />
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}

function TopBar() {
  const { t } = useTranslation("demo");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold tracking-tight">
            {t("brand")}
          </span>
          {/* Chip and the sign-in link drop below `sm` — four controls plus the wordmark
              overflow a 390px viewport, and the hero already carries a sign-in CTA. */}
          <span className="hidden rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
            {t("topbar.chip")}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            <Link to="/" data-testid="demo-topbar-back">
              <IconArrowLeft className="size-4" />
              {t("topbar.back")}
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            data-testid="demo-topbar-sign-in"
          >
            <Link to="/login">{t("topbar.sign_in")}</Link>
          </Button>
          <Button asChild size="sm" data-testid="demo-topbar-cta">
            <Link to="/sign-up">{t("topbar.cta")}</Link>
          </Button>
          <LanguageSwitcher compact />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const { t } = useTranslation("demo");
  const metrics = ["loads", "carriers", "lanes"] as const;

  return (
    <section
      className={cn(
        "relative overflow-hidden border-b border-border",
        // Borrowed from default.com (8bc1389b) as a decorative texture only — the dot colour
        // is the border token, so it inverts with the theme and adds no new colour.
        "bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px]"
      )}
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:py-24">
        <div className="flex flex-col items-start gap-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            {t("hero.eyebrow")}
          </span>

          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            {t("hero.title_lead")}
            <span className="text-primary">{t("hero.title_accent")}</span>
            {t("hero.title_trail")}
          </h1>

          <p className="max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
            {t("hero.description")}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" data-testid="demo-hero-cta">
              <Link to="/sign-up">
                {t("hero.cta_primary")}
                <IconArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              data-testid="demo-hero-sign-in"
            >
              <Link to="/login">{t("hero.cta_secondary")}</Link>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {t("hero.reassurance")}
          </p>

          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {metrics.map((metric) => (
              <div key={metric} className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-muted-foreground" />
                <dt className="sr-only">{t(`hero.metrics.${metric}`)}</dt>
                <dd>{t(`hero.metrics.${metric}`)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <DispatchBoard />
      </div>
    </section>
  );
}

/**
 * The page's memorable move: the product's actual working surface, rendered as real DOM
 * inside an inverted frame. Orderful's hero pairs the headline with a dark product panel;
 * Andercore's industrial photography was the closer logistics reference but is unbuildable
 * here, and faking it is forbidden — so this is a code-native primitive instead.
 *
 * Static by design. The filter pills are `<span>`s, not buttons, so nothing advertises
 * interactivity the demo does not have.
 */
function DispatchBoard() {
  const { t } = useTranslation("demo");
  const filters = boardFilters();

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-foreground text-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background/15 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{t("board.title")}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-background/70">
            {t("board.subtitle")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((filter, index) => (
            <span
              key={filter.key}
              className={cn(
                "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider",
                index === 0
                  ? "bg-background/20 text-background"
                  : "border border-background/20 text-background/70"
              )}
            >
              {t(`board.filters.${filter.key}`)} {filter.count}
            </span>
          ))}
        </div>
      </div>

      {/* min-w-0 is load-bearing: without it the table's min-width escapes the grid track
          and the whole page scrolls sideways on a phone instead of the board scrolling. */}
      <div className="min-w-0 overflow-x-auto">
        <table
          className="w-full min-w-[34rem] border-collapse text-left"
          aria-label={t("board.aria_label")}
          data-testid="demo-dispatch-board"
        >
          <thead>
            <tr className="border-b border-background/15 font-mono text-[10px] uppercase tracking-wider text-background/70">
              <th scope="col" className="px-4 py-2 font-normal">
                {t("board.columns.ref")}
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                {t("board.columns.lane")}
              </th>
              <th scope="col" className="hidden px-4 py-2 font-normal sm:table-cell">
                {t("board.columns.driver")}
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                {t("board.columns.status")}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-normal">
                {t("board.columns.check_call")}
              </th>
              <th scope="col" className="hidden px-4 py-2 text-right font-normal sm:table-cell">
                {t("board.columns.margin")}
              </th>
            </tr>
          </thead>
          <tbody>
            {BOARD_ROWS.map((row) => (
              <BoardRowCells key={row.ref} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-background/15 px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-background/70">
        {t("board.footer")}
      </p>
    </div>
  );
}

function BoardRowCells({ row }: { row: BoardRow }) {
  const { t } = useTranslation("demo");
  const stale = isStaleCheckCall(row);

  return (
    <tr className="border-b border-background/10 last:border-0 text-sm">
      <td className="px-4 py-3 font-mono text-xs">{row.ref}</td>
      <td className="px-4 py-3">{row.lane}</td>
      <td className="hidden px-4 py-3 text-background/70 sm:table-cell">
        {row.driver}
      </td>
      <td className="px-4 py-3">
        {/* Dot + label: the dot never carries the meaning on its own. */}
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span
            className={cn("size-1.5 rounded-full", STATUS_DOT[row.status])}
            aria-hidden="true"
          />
          {t(`board.status.${row.status}`)}
        </span>
      </td>
      <td
        className={cn(
          "px-4 py-3 text-right font-mono text-xs",
          stale ? "text-background" : "text-background/70"
        )}
        title={stale ? t("board.stale_hint") : undefined}
      >
        {t("board.check_call_minutes", { count: row.checkCallAgeMinutes })}
      </td>
      <td className="hidden px-4 py-3 text-right font-mono text-xs sm:table-cell">
        ${row.marginUsd}
      </td>
    </tr>
  );
}

/** Neutral band — the cost of the current process, before any feature talk. */
function CostBand() {
  const { t } = useTranslation("demo");
  const cards = ["calls", "tabs", "invoice"] as const;

  return (
    <section className="border-b border-border bg-muted/40">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {t("cost.title")}
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("cost.subtitle")}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <Card key={card} className="h-full">
              <CardHeader className="gap-1.5">
                <span className="font-mono text-3xl font-semibold tracking-tight">
                  {t(`cost.cards.${card}.value`)}
                </span>
                <CardTitle className="font-mono text-[11px] font-normal uppercase tracking-wider text-muted-foreground">
                  {t(`cost.cards.${card}.label`)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-muted-foreground">
                {t(`cost.cards.${card}.description`)}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Orderful's alternating two-column feature rhythm: copy on one side, a small framed panel of
 * product evidence on the other, flipping sides between rows.
 */
function FeatureBand({
  feature,
  icon,
  reversed = false,
}: {
  feature: "board" | "invoicing";
  icon: React.ReactNode;
  reversed?: boolean;
}) {
  const { t } = useTranslation("demo");
  const points = t(`features.${feature}.points`, {
    returnObjects: true,
  }) as string[];
  const rows = t(`features.${feature}.panel.rows`, {
    returnObjects: true,
  }) as string[];

  return (
    <section
      className={cn(
        "border-b border-border",
        reversed ? "bg-muted/40" : "bg-background"
      )}
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-20">
        <div
          className={cn(
            "flex flex-col items-start gap-4",
            reversed && "lg:order-2"
          )}
        >
          <span className="flex size-9 items-center justify-center rounded-md border border-border bg-card text-foreground">
            {icon}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {t(`features.${feature}.eyebrow`)}
          </span>
          <h2 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
            {t(`features.${feature}.title`)}
          </h2>
          <p className="text-pretty text-base text-muted-foreground">
            {t(`features.${feature}.description`)}
          </p>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className={cn("w-full", reversed && "lg:order-1")}>
          <div className="overflow-hidden rounded-md border border-border bg-foreground text-background shadow-sm">
            <div className="flex items-center gap-2 border-b border-background/15 px-4 py-3">
              <IconClockExclamation className="size-4 text-background/70" />
              <span className="text-sm font-medium">
                {t(`features.${feature}.panel.title`)}
              </span>
            </div>
            <ul className="divide-y divide-background/10">
              {rows.map((row) => (
                <li
                  key={row}
                  className="px-4 py-3 font-mono text-xs text-background/80"
                >
                  {row}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Sequenced from the flows layer: marketing → create account → import → work the board. */
function NextBand() {
  const { t } = useTranslation("demo");
  const steps = ["account", "import", "dispatch"] as const;

  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {t("next.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("next.subtitle")}</p>
        </div>

        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <li
              key={step}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-6"
            >
              <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
                {t(`next.steps.${step}.index`)}
              </span>
              <span className="text-base font-medium">
                {t(`next.steps.${step}.title`)}
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">
                {t(`next.steps.${step}.description`)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function CtaBand() {
  const { t } = useTranslation("demo");

  return (
    <section className="bg-muted/40">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-6 py-16 lg:py-20">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("cta.title")}
        </h2>
        <p className="max-w-2xl text-pretty text-base text-muted-foreground">
          {t("cta.description")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg" data-testid="demo-cta-primary">
            <Link to="/sign-up">
              {t("cta.primary")}
              <IconArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" data-testid="demo-cta-sign-in">
            <Link to="/login">{t("cta.secondary")}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useTranslation("demo");

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-pretty">{t("footer.disclaimer")}</p>
        <Link
          to="/"
          className="shrink-0 rounded-md font-mono text-xs uppercase tracking-wider underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="demo-footer-back"
        >
          {t("footer.back")}
        </Link>
      </div>
    </footer>
  );
}
