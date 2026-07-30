import type { Route } from "./+types/_index";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import { useFetcher } from "react-router";
import { supportedLngs } from "@/i18n";
import { cn } from "@/lib/utils";
import { i18nServer } from "@/i18n/i18n.server";
import "./loadline-theme.css";
import {
  BOARD_ROWS,
  STATUS_DOT,
  isStaleCheckCall,
  type BoardRow,
} from "./board-data";

export const handle = { i18n: ["demo"] };

/**
 * Sample marketing surface for a fictional freight-dispatch SaaS ("Loadline").
 *
 * Reference lock: 19–86 (refero style `7a8c99db`), "architectural blueprint on white marble" —
 * pure black on white, 1px rules as the only structural device, ONE weight at every size, and a
 * monumental figure standing in for the usual product screenshot. Freight runs on documents, so
 * the page is typeset as one: masthead, monument, manifest, ledger, sequence, sign-off.
 *
 * Things deliberately absent, each an anti-slop tell an earlier version of this surface failed
 * (`refero-design/references/anti-ai-slop.md`):
 *   · no cards — the reference has none, and nothing here is an interactive container
 *   · no hero with copy left and a product panel right
 *   · no accent colour, and therefore no decorative one-word colour highlight
 *   · no heading + subtitle + grid-of-three band, repeated six times
 *   · no `font-semibold` anywhere: weight 400 at every size is the reference's signature
 *
 * Marketing copy lives *inside* the manifest as marginalia on the row it describes, which is
 * why there is no feature section. Decision ledger and rejected directions:
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
 * Locale switch in the surface's own idiom: two ruled text links, no select, no shadow, no
 * weight above 400. Posts to the same `/api/set-locale` action the app-wide `LanguageSwitcher`
 * uses, so the cookie and root revalidation behave identically — only the styling differs.
 *
 * The app's `ThemeToggle` is deliberately absent: this surface pins itself light in both themes
 * (see `loadline-theme.css`), so offering a toggle that visibly does nothing here would be a lie.
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
              "border-b text-[11px] uppercase tracking-[0.14em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground",
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:border-muted-foreground hover:text-foreground"
            )}
          >
            {labels[lng] ?? lng}
          </button>
        );
      })}
    </span>
  );
}

/** Uppercase micro-label — borrowed from mono.frm.fm for column heads and captions. */
function Label({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[11px] uppercase leading-none tracking-[0.14em] text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * The reference's only interactive treatment is a text link, so CTAs are ruled text rather than
 * filled buttons. Kept as a real link with a generous hit area and a visible focus outline —
 * `focus-visible:outline` rather than a ring, because the app-wide ring defect
 * (`.brain/runs/2026-07-30-focus-ring-defect.md`) means rings never paint.
 */
function RuledLink({
  to,
  children,
  emphasis = false,
  testId,
}: {
  to: string;
  children: React.ReactNode;
  emphasis?: boolean;
  testId: string;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn(
        "inline-flex min-h-11 items-center border-b py-2 text-base leading-none transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground",
        emphasis
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:border-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Link>
  );
}

export default function DemoLanding() {
  return (
    <div
      data-surface="loadline"
      className="min-h-svh bg-background text-foreground"
    >
      <Masthead />
      <main>
        <Monument />
        <Manifest />
        <Ledger />
        <Sequence />
        <Signoff />
      </main>
    </div>
  );
}

/** Document header: wordmark, one rule, nothing else competing. */
function Masthead() {
  const { t } = useTranslation("demo");

  return (
    <header className="border-b border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 px-6 py-4 sm:px-10">
        <div className="flex items-baseline gap-3">
          <span className="text-base leading-none">{t("brand")}</span>
          <Label>{t("masthead.chip")}</Label>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link
            to="/"
            data-testid="demo-topbar-back"
            className="hidden text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground sm:inline"
          >
            {t("masthead.back")}
          </Link>
          <Link
            to="/login"
            data-testid="demo-topbar-sign-in"
            className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
          >
            {t("masthead.sign_in")}
          </Link>
          <Link
            to="/sign-up"
            data-testid="demo-topbar-cta"
            className="border-b border-foreground text-[11px] uppercase tracking-[0.14em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
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
 * The monument. The reference's hero is a single oversized figure in the same light weight as
 * body copy — scale without weight — so the page opens on the number that costs money rather
 * than on a screenshot of the product.
 */
function Monument() {
  const { t } = useTranslation("demo");

  return (
    <section className="border-b border-border px-6 pt-10 pb-8 sm:px-10">
      <p
        className="text-[clamp(6rem,26vw,22rem)] leading-[0.82] tracking-[-0.04em]"
        data-testid="demo-monument-figure"
      >
        {t("monument.figure")}
      </p>
      <Label className="mt-2 block text-foreground">
        {t("monument.caption")}
      </Label>

      <div className="mt-10 grid gap-x-16 gap-y-6 border-t border-border pt-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <p className="max-w-2xl text-xl leading-[1.35] md:text-2xl">
          {t("monument.statement")}
        </p>
        <div className="flex flex-col items-start gap-1">
          <div className="flex flex-wrap items-center gap-x-8">
            <RuledLink to="/sign-up" emphasis testId="demo-hero-cta">
              {t("monument.cta")}
            </RuledLink>
            <RuledLink to="/login" testId="demo-hero-sign-in">
              {t("monument.cta_secondary")}
            </RuledLink>
          </div>
          <Label>{t("monument.terms")}</Label>
        </div>
      </div>
    </section>
  );
}

/**
 * The manifest is the page, not an illustration of it: full-bleed, hairline-ruled, tabular.
 * Three rows carry an annotation — the marketing argument stated where its evidence is, instead
 * of in a separate feature section.
 */
function Manifest() {
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
    <section className="border-b border-border px-6 py-10 sm:px-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
        <h2 className="text-xl">{t("manifest.title")}</h2>
        <Label>{t("manifest.meta")}</Label>
      </div>

      <table
        className="mt-6 w-full border-collapse text-left align-baseline"
        data-testid="demo-dispatch-board"
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "rule-head font-normal",
                  column === "driver" && "hidden sm:table-cell",
                  (column === "check_call" || column === "margin") &&
                    "text-right",
                  column === "margin" && "hidden sm:table-cell"
                )}
              >
                <Label>{t(`manifest.columns.${column}`)}</Label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD_ROWS.map((row) => (
            <ManifestRow key={row.ref} row={row} />
          ))}
        </tbody>
      </table>

      <Label className="mt-4 block">{t("manifest.footer")}</Label>
    </section>
  );
}

function ManifestRow({ row }: { row: BoardRow }) {
  const { t } = useTranslation("demo");
  const stale = isStaleCheckCall(row);

  return (
    <>
      <tr>
        <td className="rule-row pr-4 text-sm">{row.ref}</td>
        <td className="rule-row pr-4 text-base">{row.lane}</td>
        <td className="rule-row hidden pr-4 text-base text-muted-foreground sm:table-cell">
          {row.driver}
        </td>
        <td className="rule-row pr-4 text-base">
          {/* The dot is achromatic; the label always carries the meaning. */}
          <span
            className="inline-flex items-center gap-2 whitespace-nowrap"
            data-testid="demo-board-status"
          >
            <span
              className={cn("size-1.5 shrink-0", STATUS_DOT[row.status])}
              aria-hidden="true"
            />
            {t(`manifest.status.${row.status}`)}
          </span>
        </td>
        <td
          className={cn(
            "rule-row text-right text-base",
            stale ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {t("manifest.check_call_minutes", { count: row.checkCallAgeMinutes })}
          {stale ? (
            <span className="sr-only"> — {t("manifest.stale_hint")}</span>
          ) : null}
        </td>
        <td className="rule-row hidden text-right text-base sm:table-cell">
          ${row.marginUsd}
        </td>
      </tr>

      {row.annotation ? (
        <tr>
          <td colSpan={6} className="rule-row">
            <span className="block max-w-2xl pt-1 text-base leading-snug text-muted-foreground">
              {t(`manifest.annotations.${row.annotation}`)}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Three figures as ruled ledger columns, split by hairline verticals. Not cards. */
function Ledger() {
  const { t } = useTranslation("demo");
  const rows = ["calls", "tabs", "invoice"] as const;

  return (
    <section className="border-b border-border px-6 py-10 sm:px-10">
      <h2 className="text-xl">{t("ledger.title")}</h2>

      <dl className="mt-8 grid gap-y-8 sm:grid-cols-3 sm:gap-y-0">
        {rows.map((row, index) => (
          <div
            key={row}
            className={cn(
              "flex flex-col gap-2 sm:px-8",
              index === 0 && "sm:pl-0",
              index > 0 && "sm:border-l sm:border-border",
              index === rows.length - 1 && "sm:pr-0"
            )}
          >
            <dt className="flex items-baseline gap-2">
              <span className="text-6xl leading-none tracking-[-0.03em] sm:text-7xl">
                {t(`ledger.rows.${row}.figure`)}
              </span>
              <Label>{t(`ledger.rows.${row}.unit`)}</Label>
            </dt>
            <dd className="flex flex-col gap-1">
              <span className="text-base">{t(`ledger.rows.${row}.label`)}</span>
              <span className="max-w-xs text-base leading-snug text-muted-foreground">
                {t(`ledger.rows.${row}.note`)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Numbered ruled rows, in the same table language as the manifest. */
function Sequence() {
  const { t } = useTranslation("demo");
  const steps = ["account", "import", "dispatch"] as const;

  return (
    <section className="border-b border-border px-6 py-10 sm:px-10">
      <h2 className="text-xl">{t("sequence.title")}</h2>

      <ol className="mt-6">
        {steps.map((step) => (
          <li
            key={step}
            // Real columns, not a flex row: the reference's language is tabular, and ragged
            // notes beside variable-width titles read as a list pretending to be a table.
            className="rule-row grid grid-cols-[2rem_1fr] items-baseline gap-x-8 gap-y-1 sm:grid-cols-[2rem_14rem_1fr]"
          >
            <Label>{t(`sequence.steps.${step}.index`)}</Label>
            <span className="text-base">
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

/** Closing statement, the CTA repeated once, and the honesty note. */
function Signoff() {
  const { t } = useTranslation("demo");

  return (
    <section className="px-6 py-10 sm:px-10">
      <p className="max-w-3xl text-3xl leading-[1.15] tracking-[-0.03em] sm:text-4xl">
        {t("signoff.statement")}
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-x-8">
        <RuledLink to="/sign-up" emphasis testId="demo-cta-primary">
          {t("signoff.cta")}
        </RuledLink>
        <RuledLink to="/login" testId="demo-cta-sign-in">
          {t("signoff.cta_secondary")}
        </RuledLink>
      </div>

      <div className="mt-12 grid gap-x-16 gap-y-3 border-t border-border pt-6 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Label className="block max-w-3xl leading-relaxed">
          {t("signoff.disclaimer")}
        </Label>
        <Link
          to="/"
          data-testid="demo-footer-back"
          className="justify-self-start border-b border-foreground text-[11px] uppercase tracking-[0.14em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground"
        >
          {t("signoff.back")}
        </Link>
      </div>
    </section>
  );
}
