/**
 * Demo dispatch board dataset for the `/demo` sample-SaaS surface.
 *
 * Static on purpose — the page is marketing, not a wired feature. Rows carry i18n key
 * suffixes rather than copy so `_index.tsx` can translate at the render site (same pattern
 * as `themeItems` in `theme-toggle.tsx`).
 *
 * The surface's reference lock (19–86) is strictly achromatic, so status cannot be encoded by
 * hue at all: it is a black dot for the row that needs attention, ash for a settled one, a
 * hollow ring for the ordinary case — plus the text label, always. That is a stricter encoding
 * than the usual traffic-light table, and it is why no value below names a colour.
 */

export const LOAD_STATUSES = ["rolling", "late", "delivered"] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

/**
 * Status → the dot's utility classes. Token classes only: a literal colour here is the exact
 * guardrail violation this surface exists to demonstrate against.
 *
 * Weight, not hue, carries the signal — filled black draws the eye to the row that is dark,
 * ash reads as settled, and a hollow ring is the unremarkable majority state.
 */
export const STATUS_DOT: Record<LoadStatus, string> = {
  rolling: "border border-foreground",
  late: "bg-foreground",
  delivered: "bg-muted-foreground",
};

/** i18n key suffix under `manifest.annotations`, rendered as a ruled note under the row. */
export type BoardAnnotation = "late" | "delivered" | "margin";

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
  /**
   * Marketing copy lives *inside* the manifest as marginalia on the row it is talking about,
   * rather than in a separate feature section beside it. Only three rows carry one — an
   * annotation on every row would be a feature grid wearing a table's clothes.
   */
  readonly annotation?: BoardAnnotation;
}

export const BOARD_ROWS: readonly BoardRow[] = [
  {
    ref: "LL-4821",
    lane: "Laredo, TX → Memphis, TN",
    driver: "R. Okafor",
    status: "rolling",
    checkCallAgeMinutes: 12,
    marginUsd: 640,
    annotation: "margin",
  },
  {
    ref: "LL-4818",
    lane: "Fontana, CA → Phoenix, AZ",
    driver: "M. Dukes",
    status: "late",
    checkCallAgeMinutes: 214,
    marginUsd: 180,
    annotation: "late",
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
    annotation: "delivered",
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
