/**
 * Demo dispatch board dataset for the `/demo` sample-SaaS surface.
 *
 * Static on purpose — the page is marketing, not a wired feature. Rows carry i18n key
 * suffixes rather than copy so `_index.tsx` can translate at the render site (same pattern
 * as `themeItems` in `theme-toggle.tsx`).
 *
 * Status colors are semantic tokens only, and only where the color earns its place: an alarm
 * state gets `--destructive`, a completed one gets a chart token, and the normal state gets no
 * color at all. That follows the "one accent, color rare" pillar in
 * `.brain/codebase/design-system.md`. Every status also renders a text label — the dot alone
 * must never carry the meaning.
 */

export const LOAD_STATUSES = ["rolling", "late", "delivered"] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

/**
 * Status → semantic token utility class for the indicator dot.
 *
 * `rolling` is the unremarkable majority state, so it stays neutral; color is spent only on
 * the two states a dispatcher needs to spot. Values must stay token classes — a literal
 * color here is the exact guardrail violation this surface exists to demonstrate against.
 */
export const STATUS_DOT: Record<LoadStatus, string> = {
  rolling: "bg-muted-foreground",
  late: "bg-destructive",
  delivered: "bg-chart-2",
};

export interface BoardRow {
  /** Load reference as an ops person would read it. */
  readonly ref: string;
  /** Origin → destination, already abbreviated to city + state. */
  readonly lane: string;
  /** Driver first name + last initial, matching how dispatchers label rows. */
  readonly driver: string;
  readonly status: LoadStatus;
  /** Minutes since the last check-call. The number the whole board exists to surface. */
  readonly checkCallAgeMinutes: number;
  /** Margin on the load, in whole dollars. */
  readonly marginUsd: number;
}

export const BOARD_ROWS: readonly BoardRow[] = [
  {
    ref: "LL-4821",
    lane: "Laredo, TX → Memphis, TN",
    driver: "R. Okafor",
    status: "rolling",
    checkCallAgeMinutes: 12,
    marginUsd: 640,
  },
  {
    ref: "LL-4818",
    lane: "Fontana, CA → Phoenix, AZ",
    driver: "M. Dukes",
    status: "late",
    checkCallAgeMinutes: 214,
    marginUsd: 180,
  },
  {
    ref: "LL-4809",
    lane: "Joliet, IL → Columbus, OH",
    driver: "T. Vasquez",
    status: "rolling",
    checkCallAgeMinutes: 38,
    marginUsd: 415,
  },
  {
    ref: "LL-4794",
    lane: "Savannah, GA → Charlotte, NC",
    driver: "K. Bhatt",
    status: "delivered",
    checkCallAgeMinutes: 6,
    marginUsd: 720,
  },
  {
    ref: "LL-4790",
    lane: "Newark, NJ → Allentown, PA",
    driver: "D. Whitfield",
    status: "rolling",
    checkCallAgeMinutes: 91,
    marginUsd: 265,
  },
] as const;

/**
 * A load is stale when nobody has heard from the driver in over 90 minutes — the threshold
 * the board's "late" framing and the marketing copy both refer to. Named rather than inlined
 * so the copy and the highlight can never drift apart.
 */
export const STALE_CHECK_CALL_MINUTES = 90;

export function isStaleCheckCall(row: BoardRow): boolean {
  return row.checkCallAgeMinutes > STALE_CHECK_CALL_MINUTES;
}

/** Filter pills above the board, mirroring the screens-layer reference pattern. */
export interface BoardFilter {
  /** i18n key suffix under `board.filters`. */
  readonly key: "all" | LoadStatus;
  readonly count: number;
}

export function boardFilters(
  rows: readonly BoardRow[] = BOARD_ROWS
): readonly BoardFilter[] {
  return [
    { key: "all", count: rows.length },
    ...LOAD_STATUSES.map((status) => ({
      key: status,
      count: rows.filter((row) => row.status === status).length,
    })),
  ];
}
