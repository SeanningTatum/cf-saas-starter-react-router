import type { Route } from "./+types/_index";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";

import { supportedLngs } from "@/i18n";
import { cn } from "@/lib/utils";
import { i18nServer } from "@/i18n/i18n.server";
import "./loadline-theme.css";
import {
  BOARD_ROWS,
  DARK_LOAD_REF,
  DARK_LOAD_START_MINUTES,
  isStaleCheckCall,
  type BoardRow,
} from "./board-data";

export const handle = { i18n: ["demo"] };

/**
 * Sample marketing surface for a fictional freight-dispatch SaaS ("Loadline").
 *
 * A night-shift instrument: deep neutral canvas, layered panels, one amber signal spent only where
 * something is actually wrong, and the product's own board shown as the hero — because in this
 * category the buyer wants to see the board, and the earlier passes of this page refused to.
 *
 * The craft lives in `loadline-theme.css`: hairline borders at low alpha, a 1px inner highlight on
 * raised surfaces, one ambient glow, a barely-there grid field, and real display + mono faces.
 * Scoped design system rules: `.brain/rules/frontend.md`. Decision history, including the three
 * directions this replaced and why each was rejected:
 * `.brain/features/sample-saas-landing/sample-saas-landing.md`.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const t = await i18nServer.getFixedT(request, "demo");
  return {
    meta: { title: t("meta.title"), description: t("meta.description") },
  };
}

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.meta.title },
    { name: "description", content: data?.meta.description },
  ];
}

/** The dark load's age, climbing at the real cadence. Static under reduced motion. */
function useClimbingMinutes(from: number): number {
  const [minutes, setMinutes] = useState(from);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setMinutes((m) => m + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return minutes;
}

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--signal)]";

/** Small caps label, mono, for instrument legends. */
function Legend({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-data text-[10px] uppercase leading-none tracking-[0.18em] text-[color:var(--text-lo)]",
        className
      )}
    >
      {children}
    </span>
  );
}

export default function DemoLanding() {
  return (
    <div
      data-surface="loadline"
      className="min-h-svh bg-[color:var(--ink-0)] text-[color:var(--text-hi)] antialiased"
    >
      <Nav />
      <main>
        <Hero />
        <Board />
        <Detail />
        <Close />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  const { t } = useTranslation("demo");

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--line)] bg-[color:var(--ink-0)]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[76rem] items-center justify-between gap-6 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span
            className="beacon size-1.5 rounded-full bg-[color:var(--text-lo)]"
            aria-hidden="true"
          />
          <span className="font-display text-[15px] font-semibold">
            {t("brand")}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Link
            to="/"
            data-testid="demo-topbar-back"
            className={cn(
              "hidden rounded-md px-3 py-2 text-[13px] text-[color:var(--text-lo)] transition-colors hover:text-[color:var(--text-hi)] sm:inline-block",
              FOCUS
            )}
          >
            {t("masthead.back")}
          </Link>
          <Link
            to="/login"
            data-testid="demo-topbar-sign-in"
            className={cn(
              "rounded-md px-3 py-2 text-[13px] text-[color:var(--text-lo)] transition-colors hover:text-[color:var(--text-hi)]",
              FOCUS
            )}
          >
            {t("masthead.sign_in")}
          </Link>
          <Link
            to="/sign-up"
            data-testid="demo-topbar-cta"
            className={cn(
              "rounded-md bg-[color:var(--signal)] px-3.5 py-2 text-[13px] font-semibold text-[color:var(--signal-ink)] transition-opacity hover:opacity-90",
              FOCUS
            )}
          >
            {t("masthead.cta")}
          </Link>
          <LocaleSwitch />
        </div>
      </div>
    </header>
  );
}

/**
 * Locale switch. Posts to the same `/api/set-locale` action the app-wide `LanguageSwitcher` uses.
 * The app's `ThemeToggle` is deliberately absent: this surface pins its own theme, so offering a
 * toggle that did nothing here would be a lie.
 */
function LocaleSwitch() {
  const { i18n } = useTranslation();
  const fetcher = useFetcher();
  const labels: Record<string, string> = { en: "EN", zh: "中文" };

  return (
    <span className="ml-1 flex items-center gap-1">
      {supportedLngs.map((lng) => {
        const active = i18n.language === lng;
        return (
          <button
            key={lng}
            type="button"
            data-testid={`demo-locale-${lng}`}
            aria-current={active ? "true" : undefined}
            disabled={active || fetcher.state !== "idle"}
            onClick={() =>
              fetcher.submit(
                { lng },
                { method: "post", action: "/api/set-locale" }
              )
            }
            className={cn(
              "font-data rounded px-1.5 py-1 text-[11px] transition-colors",
              active
                ? "text-[color:var(--text-hi)]"
                : "text-[color:var(--text-lo)] hover:text-[color:var(--text-hi)]",
              FOCUS
            )}
          >
            {labels[lng] ?? lng}
          </button>
        );
      })}
    </span>
  );
}

function Hero() {
  const { t } = useTranslation("demo");
  const minutes = useClimbingMinutes(DARK_LOAD_START_MINUTES);

  return (
    <section className="ambient grid-field relative overflow-hidden border-b border-[color:var(--line)]">
      <div className="relative z-10 mx-auto grid max-w-[76rem] items-center gap-14 px-6 pt-20 pb-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-10 lg:pt-28 lg:pb-24">
        <div className="rise flex flex-col items-start gap-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--line-strong)] bg-[color:var(--ink-1)] py-1.5 pr-3.5 pl-2.5">
            <span
              className="beacon size-1.5 rounded-full bg-[color:var(--text-lo)]"
              aria-hidden="true"
            />
            <Legend className="text-[color:var(--text-hi)]">
              {t("hero.eyebrow")}
            </Legend>
          </span>

          <h1 className="font-display text-[2.75rem] font-semibold leading-[1.02] text-balance sm:text-[3.5rem] lg:text-[4rem]">
            {t("hero.title")}
          </h1>

          <p className="max-w-xl text-[17px] leading-relaxed text-[color:var(--text-lo)]">
            {t("hero.body")}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/sign-up"
              data-testid="demo-hero-cta"
              className={cn(
                "rounded-lg bg-[color:var(--signal)] px-5 py-3 text-[14px] font-semibold text-[color:var(--signal-ink)] shadow-[0_8px_24px_-8px_rgba(255,176,46,0.5)] transition-transform hover:-translate-y-px",
                FOCUS
              )}
            >
              {t("hero.cta")}
            </Link>
            <Link
              to="/login"
              data-testid="demo-hero-sign-in"
              className={cn(
                "rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--ink-1)] px-5 py-3 text-[14px] font-medium text-[color:var(--text-hi)] transition-colors hover:border-[color:var(--text-lo)]",
                FOCUS
              )}
            >
              {t("hero.cta_secondary")}
            </Link>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Legend>{t("hero.trust")}</Legend>
          </div>
        </div>

        {/* The product, shown. It overflows the right edge on large screens so the page reads as a
            window into a running app rather than a screenshot pasted into a column. */}
        {/* Bleeds past the container so the page reads as a window into a running app — but only
            as far as the last column can afford, because the age is the point. */}
        <div className="rise relative lg:-mr-8 xl:-mr-14">
          <BoardPanel minutes={minutes} />
        </div>
      </div>
    </section>
  );
}

/** The dispatch board as a product panel: window chrome, live filters, real rows. */
function BoardPanel({ minutes }: { minutes: number }) {
  const { t } = useTranslation("demo");

  return (
    <div className="raised overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-4 border-b border-[color:var(--line)] bg-[color:var(--ink-2)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="beacon size-1.5 rounded-full bg-[color:var(--text-lo)]"
            aria-hidden="true"
          />
          <span className="font-data text-[11px] tracking-tight text-[color:var(--text-hi)]">
            {t("panel.title")}
          </span>
        </div>
        <Legend>{t("panel.meta")}</Legend>
      </div>

      <div className="flex items-center gap-1.5 border-b border-[color:var(--line)] px-4 py-2.5">
        {(["all", "rolling", "late"] as const).map((key, index) => (
          <span
            key={key}
            className={cn(
              "font-data rounded-md px-2 py-1 text-[10px] uppercase tracking-[0.12em]",
              index === 0
                ? "bg-[color:var(--ink-2)] text-[color:var(--text-hi)]"
                : "text-[color:var(--text-lo)]"
            )}
          >
            {t(`panel.filters.${key}`)}
          </span>
        ))}
      </div>

      <table
        className="w-full border-collapse text-left"
        data-testid="demo-dispatch-board"
      >
        <thead>
          <tr>
            {(["ref", "lane", "status", "check_call"] as const).map((column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "px-3.5 pt-3 pb-2 text-left font-normal",
                  column === "check_call" && "pr-4 text-right"
                )}
              >
                <Legend>{t(`manifest.columns.${column}`)}</Legend>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD_ROWS.map((row) => (
            <PanelRow key={row.ref} row={row} minutes={minutes} />
          ))}
        </tbody>
      </table>

      <div className="border-t border-[color:var(--line)] px-4 py-3">
        <Legend>{t("panel.footer")}</Legend>
      </div>
    </div>
  );
}

function PanelRow({ row, minutes }: { row: BoardRow; minutes: number }) {
  const { t } = useTranslation("demo");
  const alert = row.ref === DARK_LOAD_REF;
  const stale = isStaleCheckCall(row);
  const age = alert ? minutes : row.checkCallAgeMinutes;

  return (
    <tr className={cn("board-row", alert && "board-row-alert")}>
      <td className="font-data px-3.5 py-3 text-[12px] whitespace-nowrap text-[color:var(--text-lo)]">
        {row.ref}
      </td>
      <td className="px-3.5 py-3 text-[13px] whitespace-nowrap">
        <span className="sm:hidden">{row.shortLane}</span>
        <span className="hidden sm:inline">{row.lane}</span>
      </td>
      <td className="px-3.5 py-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap",
            alert
              ? "border-[color:var(--signal)]/40 bg-[color:var(--signal)]/10 text-[color:var(--signal)]"
              : "border-[color:var(--line)] text-[color:var(--text-lo)]"
          )}
          data-testid="demo-board-status"
        >
          {alert ? (
            <span
              className="beacon size-1 rounded-full bg-[color:var(--signal)]"
              aria-hidden="true"
            />
          ) : null}
          {t(`manifest.status.${row.status}`)}
        </span>
      </td>
      {/* The signal sits on the figure, not on the cell: the alarming thing is the number, and
          scoping it that way keeps the accent off everything that merely lives in the same cell. */}
      <td className="font-data px-3.5 py-3 pr-4 text-right text-[12px] whitespace-nowrap text-[color:var(--text-lo)]">
        <span
          className={cn(
            alert
              ? "text-[color:var(--signal)]"
              : stale
                ? "text-[color:var(--text-hi)]"
                : undefined
          )}
        >
          {t("manifest.check_call_minutes", { count: age })}
        </span>
        {stale ? (
          <span className="sr-only"> — {t("manifest.stale_hint")}</span>
        ) : null}
      </td>
    </tr>
  );
}

/** The number that costs money, at scale, with the three figures that explain it. */
function Board() {
  const { t } = useTranslation("demo");
  const rows = ["calls", "tabs", "invoice"] as const;
  const minutes = useClimbingMinutes(DARK_LOAD_START_MINUTES);

  return (
    <section className="border-b border-[color:var(--line)]">
      <div className="mx-auto max-w-[76rem] px-6 py-16 lg:py-20">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-end gap-5">
            {/* Scale, not hue. At 7rem this figure already dominates the section; painting it
                amber too spent the signal on a number that is narrating, not alarming. The
                through-line to the board row is the datum itself — same minutes, same climb. */}
            <span
              className="font-display text-[color:var(--text-hi)] text-[5.5rem] leading-[0.85] font-semibold sm:text-[7rem]"
              data-testid="demo-monument-figure"
            >
              {minutes}
            </span>
            <div className="flex flex-col gap-2 pb-2">
              <Legend>{t("cost.figure_unit")}</Legend>
              <p className="max-w-xs text-[15px] leading-snug text-[color:var(--text-hi)]">
                {t("cost.figure_note")}
              </p>
            </div>
          </div>

          <dl className="grid gap-6 sm:grid-cols-3 lg:max-w-2xl lg:gap-8">
            {rows.map((row) => (
              <div
                key={row}
                className="flex flex-col gap-1.5 border-t border-[color:var(--line)] pt-4"
              >
                <dt className="font-display text-[1.75rem] leading-none font-semibold">
                  {t(`ledger.rows.${row}.figure`)}
                  <span className="ml-1.5 text-[13px] font-normal text-[color:var(--text-lo)]">
                    {t(`ledger.rows.${row}.unit`)}
                  </span>
                </dt>
                <dd className="text-[13px] leading-snug text-[color:var(--text-lo)]">
                  <span className="block text-[color:var(--text-hi)]">
                    {t(`ledger.rows.${row}.label`)}
                  </span>
                  {t(`ledger.rows.${row}.note`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** Two asymmetric rows, each pairing a claim with the piece of product that proves it. */
function Detail() {
  const { t } = useTranslation("demo");

  return (
    <section className="border-b border-[color:var(--line)]">
      <div className="mx-auto flex max-w-[76rem] flex-col gap-16 px-6 py-16 lg:gap-24 lg:py-24">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col items-start gap-4">
            <Legend>{t("detail.checkcall.eyebrow")}</Legend>
            <h2 className="font-display max-w-md text-[1.75rem] leading-tight font-semibold sm:text-[2.25rem]">
              {t("detail.checkcall.title")}
            </h2>
            <p className="max-w-md text-[15px] leading-relaxed text-[color:var(--text-lo)]">
              {t("detail.checkcall.body")}
            </p>
          </div>
          <LedgerPanel kind="checkcall" />
        </div>

        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col items-start gap-4 lg:order-2">
            <Legend>{t("detail.invoice.eyebrow")}</Legend>
            <h2 className="font-display max-w-md text-[1.75rem] leading-tight font-semibold sm:text-[2.25rem]">
              {t("detail.invoice.title")}
            </h2>
            <p className="max-w-md text-[15px] leading-relaxed text-[color:var(--text-lo)]">
              {t("detail.invoice.body")}
            </p>
          </div>
          <div className="lg:order-1">
            <LedgerPanel kind="invoice" />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A small slice of real product UI: an event ledger, or an invoice draft. */
function LedgerPanel({ kind }: { kind: "checkcall" | "invoice" }) {
  const { t } = useTranslation("demo");
  const lines = t(`detail.${kind}.lines`, { returnObjects: true }) as string[];

  return (
    <div className="raised overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-[color:var(--line)] bg-[color:var(--ink-2)] px-4 py-2.5">
        <span className="font-data text-[11px] text-[color:var(--text-hi)]">
          {t(`detail.${kind}.panel`)}
        </span>
        <Legend>{t(`detail.${kind}.panel_meta`)}</Legend>
      </div>
      <ul>
        {lines.map((line, index) => (
          <li
            key={line}
            className={cn(
              "font-data flex items-baseline gap-3 px-4 py-3 text-[12px] leading-relaxed",
              index > 0 && "border-t border-[color:var(--line)]",
              // The escalated line leads by brightness, not by hue — a log's newest entry is
              // emphasis, and amber on this surface means a load is dark.
              index === 0 && kind === "checkcall"
                ? "text-[color:var(--text-hi)]"
                : "text-[color:var(--text-lo)]"
            )}
          >
            <span className="text-[color:var(--text-lo)]/60">
              {String(index + 1).padStart(2, "0")}
            </span>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Close() {
  const { t } = useTranslation("demo");

  return (
    <section className="ambient relative overflow-hidden">
      <div className="relative z-10 mx-auto flex max-w-[76rem] flex-col items-start gap-7 px-6 py-20 lg:py-28">
        <h2 className="font-display max-w-2xl text-[2.25rem] leading-[1.05] font-semibold text-balance sm:text-[3rem]">
          {t("signoff.statement")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/sign-up"
            data-testid="demo-cta-primary"
            className={cn(
              "rounded-lg bg-[color:var(--signal)] px-5 py-3 text-[14px] font-semibold text-[color:var(--signal-ink)] shadow-[0_8px_24px_-8px_rgba(255,176,46,0.5)] transition-transform hover:-translate-y-px",
              FOCUS
            )}
          >
            {t("signoff.cta")}
          </Link>
          <Link
            to="/login"
            data-testid="demo-cta-sign-in"
            className={cn(
              "rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--ink-1)] px-5 py-3 text-[14px] font-medium transition-colors hover:border-[color:var(--text-lo)]",
              FOCUS
            )}
          >
            {t("signoff.cta_secondary")}
          </Link>
        </div>
        <Legend>{t("hero.trust")}</Legend>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useTranslation("demo");

  return (
    <footer className="border-t border-[color:var(--line)]">
      <div className="mx-auto flex max-w-[76rem] flex-col gap-3 px-6 py-8 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-[12px] leading-relaxed text-[color:var(--text-lo)]">
          {t("signoff.disclaimer")}
        </p>
        <Link
          to="/"
          data-testid="demo-footer-back"
          className={cn(
            "font-data shrink-0 text-[11px] text-[color:var(--text-lo)] transition-colors hover:text-[color:var(--text-hi)]",
            FOCUS
          )}
        >
          {t("signoff.back")}
        </Link>
      </div>
    </footer>
  );
}
