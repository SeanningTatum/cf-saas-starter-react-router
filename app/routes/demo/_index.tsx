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
 * Reference lock: EVOKE (refero `1e802d79`) for billboard clarity — oversized type on saturated
 * flat panels, full-bleed sections, 0px radius, no gradients — with the palette taken from the
 * MUTCD, the actual specification for US highway signage. incident.io (`3fcc8a86`) contributes one
 * rule: a vivid accent belongs to genuine urgency and nothing else.
 *
 * The idea: dispatch is the road. A dispatcher's night is destinations, distances and one truck
 * that has gone quiet, which is what highway signage exists to communicate to someone with three
 * seconds to read it. So the page opens as a guide sign, not as a hero — and the minutes on it
 * climb while you watch, because a board that does not move is not a board.
 *
 * Full decision ledger, and the three directions this replaced:
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

/**
 * The dark load's age, climbing in real time.
 *
 * Starts from the server-rendered value so there is no hydration mismatch, then increments once a
 * minute — the real cadence of the thing it measures, not a fake fast ticker. Visitors who asked
 * for reduced motion get the static figure.
 */
function useClimbingMinutes(from: number): number {
  const [minutes, setMinutes] = useState(from);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setMinutes((m) => m + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return minutes;
}

/** Small uppercase sign legend. */
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
        "text-[11px] font-bold uppercase leading-none tracking-[0.16em]",
        className
      )}
    >
      {children}
    </span>
  );
}

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current";

export default function DemoLanding() {
  return (
    <div
      data-surface="loadline"
      className="min-h-svh bg-background text-foreground"
    >
      <Masthead />
      <main>
        <GuideSign />
        <Board />
        <Ledger />
        <Sequence />
        <Signoff />
      </main>
    </div>
  );
}

function Masthead() {
  const { t } = useTranslation("demo");

  return (
    <header className="border-b-4 border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4 sm:px-8">
        <span className="text-lg font-extrabold uppercase tracking-[0.04em]">
          {t("brand")}
        </span>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            to="/"
            data-testid="demo-topbar-back"
            className={cn(
              "hidden text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground sm:inline",
              FOCUS
            )}
          >
            {t("masthead.back")}
          </Link>
          <Link
            to="/login"
            data-testid="demo-topbar-sign-in"
            className={cn(
              "text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground",
              FOCUS
            )}
          >
            {t("masthead.sign_in")}
          </Link>
          <Link
            to="/sign-up"
            data-testid="demo-topbar-cta"
            className={cn(
              "sign sign-type px-4 py-2.5 text-[11px] tracking-[0.16em]",
              FOCUS
            )}
          >
            {t("masthead.cta")}
          </Link>
          <LocaleRule />
        </div>
      </div>
    </header>
  );
}

/**
 * Locale switch as two sign legends. Posts to the same `/api/set-locale` action the app-wide
 * `LanguageSwitcher` uses; only the styling differs. The app's `ThemeToggle` is deliberately
 * absent — this surface pins itself light, so a toggle that did nothing here would be a lie.
 */
function LocaleRule() {
  const { i18n } = useTranslation();
  const fetcher = useFetcher();
  const labels: Record<string, string> = { en: "EN", zh: "中文" };

  return (
    <span className="flex items-center gap-3">
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
              "text-[11px] font-bold uppercase tracking-[0.16em]",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
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

/**
 * The hero is a guide sign: exit tab, destination, and a mile-marker figure that climbs. Under it,
 * a safety-orange hazard placard states what the number means — the two are adjacent by design, so
 * a non-dispatcher never has to work out why 214 is alarming.
 */
function GuideSign() {
  const { t } = useTranslation("demo");
  const minutes = useClimbingMinutes(DARK_LOAD_START_MINUTES);

  return (
    <section>
      <div className="px-5 pt-6 sm:px-8">
        {/* Exit tab sits on the shoulder of the panel, as it does on the road. */}
        <div className="sign sign-type inline-block px-5 py-2 text-[11px] tracking-[0.16em]">
          {t("sign.tab")}
        </div>

        <div className="sign relative overflow-hidden px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
            <div className="flex flex-col gap-3">
              <Legend className="opacity-80">{t("sign.origin")}</Legend>
              <p className="sign-type text-4xl leading-[0.95] sm:text-6xl lg:text-7xl">
                {t("sign.destination")}
              </p>
            </div>

            <div className="flex items-end gap-4">
              <span
                className="marker text-[clamp(7rem,22vw,14rem)] leading-[0.78]"
                data-testid="demo-monument-figure"
                data-base-minutes={DARK_LOAD_START_MINUTES}
              >
                {minutes}
              </span>
              <Legend className="pb-3 sm:pb-5">{t("sign.unit")}</Legend>
            </div>
          </div>
        </div>

        {/* Hazard placard: the only orange on the page, and it is an actual alarm. */}
        <div
          className="sign-hazard sign-type flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4 text-sm tracking-[0.08em] sm:px-10"
          data-testid="demo-hazard"
        >
          <span aria-hidden="true" className="is-dark-load text-lg leading-none">
            ▲
          </span>
          {t("sign.hazard")}
        </div>
      </div>

      <div className="centre-line mt-8" aria-hidden="true" />

      <div className="flex flex-wrap items-center justify-between gap-x-12 gap-y-6 border-b-4 border-border px-5 py-8 sm:px-8">
        <p className="max-w-2xl text-2xl font-bold leading-[1.15] tracking-[-0.02em] sm:text-4xl">
          {t("sign.statement")}
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            to="/sign-up"
            data-testid="demo-hero-cta"
            className={cn(
              "sign sign-type px-7 py-4 text-sm tracking-[0.12em]",
              FOCUS
            )}
          >
            {t("sign.cta")}
          </Link>
          <Link
            to="/login"
            data-testid="demo-hero-sign-in"
            className={cn(
              "border-b-2 border-border pb-1 text-sm font-bold uppercase tracking-[0.12em]",
              FOCUS
            )}
          >
            {t("sign.cta_secondary")}
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Tonight's board. Road-marking rules, uppercase column legends, and the dark load carried on an
 * orange placard row rather than a coloured dot. Three rows carry an annotation — the marketing
 * argument stated where its evidence is, which is why there is no feature section.
 */
function Board() {
  const { t } = useTranslation("demo");
  const columns = [
    "ref",
    "lane",
    "driver",
    "status",
    "check_call",
    "margin",
  ] as const;

  return (
    <section className="border-b-4 border-border px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="text-2xl font-extrabold uppercase tracking-[0.02em]">
          {t("manifest.title")}
        </h2>
        <Legend className="text-muted-foreground">{t("manifest.meta")}</Legend>
      </div>

      <table
        className="mt-6 w-full border-collapse text-left"
        data-testid="demo-dispatch-board"
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "lane-head pr-3 pb-2 font-normal last:pr-0 sm:pr-4",
                  column === "driver" && "hidden sm:table-cell",
                  (column === "check_call" || column === "margin") && "text-right"
                )}
              >
                <Legend className="text-muted-foreground">
                  {t(`manifest.columns.${column}`)}
                </Legend>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD_ROWS.map((row) => (
            <BoardRowCells key={row.ref} row={row} />
          ))}
        </tbody>
      </table>

      <Legend className="mt-4 block text-muted-foreground">
        {t("manifest.footer")}
      </Legend>
    </section>
  );
}

/** Which column each annotation argues for — the note's right edge lands under it. */
const ANNOTATION_TARGET: Record<NonNullable<BoardRow["annotation"]>, number> = {
  delivered: 4,
  late: 5,
  margin: 6,
};

function BoardRowCells({ row }: { row: BoardRow }) {
  const { t } = useTranslation("demo");
  const stale = isStaleCheckCall(row);
  const dark = row.ref === DARK_LOAD_REF;
  const minutes = useClimbingMinutes(row.checkCallAgeMinutes);
  const annotated = Boolean(row.annotation);

  return (
    <>
      <tr
        className={cn(
          annotated && "[&>td]:border-b-0",
          dark && "sign-hazard sign-type [&>td]:px-2 [&>td:first-child]:pl-4 [&>td:last-child]:pr-4"
        )}
      >
        <td className="lane-row whitespace-nowrap py-3 pr-3 text-sm font-bold sm:pr-4">
          {row.ref}
        </td>
        <td className="lane-row py-3 pr-3 text-sm font-bold uppercase tracking-[0.04em] sm:pr-4 sm:text-base">
          <span className="sm:hidden">{row.shortLane}</span>
          <span className="hidden sm:inline">{row.lane}</span>
        </td>
        <td
          className={cn(
            "lane-row hidden py-3 pr-3 text-base sm:table-cell sm:pr-4",
            dark ? "" : "text-muted-foreground"
          )}
        >
          {row.driver}
        </td>
        <td className="lane-row py-3 pr-3 text-xs font-bold uppercase tracking-[0.04em] sm:pr-4 sm:text-sm sm:tracking-[0.08em]">
          {t(`manifest.status.${row.status}`)}
        </td>
        <td
          className={cn(
            "lane-row marker whitespace-nowrap py-3 pr-3 text-right text-sm sm:pr-0 sm:text-base",
            dark ? "text-lg" : stale ? "" : "text-muted-foreground"
          )}
        >
          {t("manifest.check_call_minutes", { count: minutes })}
          {stale ? (
            <span className="sr-only"> — {t("manifest.stale_hint")}</span>
          ) : null}
        </td>
        <td className="lane-row marker whitespace-nowrap py-3 text-right text-sm sm:text-base">
          ${row.marginUsd}
        </td>
      </tr>

      {row.annotation ? (
        <tr>
          <td colSpan={6} className="lane-row pb-3">
            {/* Right-padding places the note's right edge under the column it argues for, without
                the short rule that reads as a broken table edge. */}
            <span
              className="block text-right text-sm leading-snug text-muted-foreground sm:text-base"
              style={{ paddingRight: `var(--annot-pad-${row.annotation}, 0)` }}
            >
              {t(`manifest.annotations.${row.annotation}`)}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The cost of a shift, on warning-yellow panels: three figures at mile-marker scale. */
function Ledger() {
  const { t } = useTranslation("demo");
  const rows = ["calls", "tabs", "invoice"] as const;

  return (
    <section className="border-b-4 border-border">
      <div className="px-5 pt-10 sm:px-8">
        <h2 className="text-2xl font-extrabold uppercase tracking-[0.02em]">
          {t("ledger.title")}
        </h2>
      </div>

      <div className="mt-8 grid sm:grid-cols-3">
        {rows.map((row, index) => (
          <div
            key={row}
            className={cn(
              "sign-warning flex flex-col justify-between gap-6 px-5 py-8 sm:px-8",
              index > 0 && "border-t-4 border-border sm:border-t-0 sm:border-l-4"
            )}
          >
            <div className="flex items-end gap-3">
              <span className="marker text-6xl leading-none sm:text-7xl">
                {t(`ledger.rows.${row}.figure`)}
              </span>
              <Legend className="pb-2">{t(`ledger.rows.${row}.unit`)}</Legend>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-bold uppercase tracking-[0.06em]">
                {t(`ledger.rows.${row}.label`)}
              </span>
              <span className="text-base leading-snug">
                {t(`ledger.rows.${row}.note`)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Mile markers: numbered rows in the board's own language. */
function Sequence() {
  const { t } = useTranslation("demo");
  const steps = ["account", "import", "dispatch"] as const;

  return (
    <section className="border-b-4 border-border px-5 py-10 sm:px-8">
      <h2 className="text-2xl font-extrabold uppercase tracking-[0.02em]">
        {t("sequence.title")}
      </h2>

      <ol className="mt-6">
        {steps.map((step) => (
          <li
            key={step}
            className="lane-row grid grid-cols-[3rem_1fr] items-baseline gap-x-6 gap-y-1 py-4 sm:grid-cols-[3rem_16rem_1fr]"
          >
            <span className="marker text-2xl leading-none">
              {t(`sequence.steps.${step}.index`)}
            </span>
            <span className="text-base font-bold uppercase tracking-[0.06em]">
              {t(`sequence.steps.${step}.title`)}
            </span>
            <span className="col-start-2 text-base text-muted-foreground sm:col-start-3">
              {t(`sequence.steps.${step}.note`)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Closing guide sign: the destination, one more time. */
function Signoff() {
  const { t } = useTranslation("demo");

  return (
    <section>
      <div className="sign px-6 py-12 sm:px-10 sm:py-16">
        <p className="sign-type max-w-4xl text-3xl leading-[1.05] sm:text-5xl lg:text-6xl">
          {t("signoff.statement")}
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link
            to="/sign-up"
            data-testid="demo-cta-primary"
            className={cn(
              "sign-type bg-white px-7 py-4 text-sm tracking-[0.12em] text-[color:var(--sign-green)]",
              FOCUS
            )}
          >
            {t("signoff.cta")}
          </Link>
          <Link
            to="/login"
            data-testid="demo-cta-sign-in"
            className={cn(
              "border-b-2 border-current pb-1 text-sm font-bold uppercase tracking-[0.12em]",
              FOCUS
            )}
          >
            {t("signoff.cta_secondary")}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-12 gap-y-4 px-5 py-8 sm:px-8">
        <Legend className="max-w-3xl leading-relaxed text-muted-foreground">
          {t("signoff.disclaimer")}
        </Legend>
        <Link
          to="/"
          data-testid="demo-footer-back"
          className={cn(
            "border-b-2 border-border pb-1 text-[11px] font-bold uppercase tracking-[0.16em]",
            FOCUS
          )}
        >
          {t("signoff.back")}
        </Link>
      </div>
    </section>
  );
}
