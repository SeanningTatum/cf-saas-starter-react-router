import { describe, it, expect } from "vitest";
import {
  BOARD_ROWS,
  DARK_LOAD_REF,
  DARK_LOAD_START_MINUTES,
  STALE_CHECK_CALL_MINUTES,
  isStaleCheckCall,
  type BoardRow,
} from "../board-data";

/**
 * The `/demo` surface exists to prove the design guardrail in `.brain/rules/frontend.md`: the
 * research drives structure, the tokens own colour, and a scoped surface may bring its own
 * tokens without leaking. These tests pin the parts of that claim code can break.
 */

describe("DARK_LOAD_REF", () => {
  // Catches the hero sign losing its subject: the sign, the hazard placard and the ticking figure
  // are all about one specific load, so that load must exist on the board.
  it("names a load that is actually on the board", () => {
    const row = BOARD_ROWS.find((r) => r.ref === DARK_LOAD_REF);
    expect(row).toBeDefined();
    expect(row!.status).toBe("late");
  });

  // Catches the hero figure and the board row disagreeing — they must start from the same number,
  // because the client ticks both up from the server-rendered value.
  it("starts the climbing figure from that load's own check-call age", () => {
    const row = BOARD_ROWS.find((r) => r.ref === DARK_LOAD_REF)!;
    expect(DARK_LOAD_START_MINUTES).toBe(row.checkCallAgeMinutes);
  });

  // Catches a dark load that is not actually stale, which would make the hazard placard a lie.
  it("is stale by the page's own threshold", () => {
    const row = BOARD_ROWS.find((r) => r.ref === DARK_LOAD_REF)!;
    expect(isStaleCheckCall(row)).toBe(true);
  });
});

describe("isStaleCheckCall", () => {
  const row = (checkCallAgeMinutes: number): BoardRow => ({
    ref: "T-1",
    lane: "A → B",
    shortLane: "A → B",
    driver: "X",
    status: "rolling",
    checkCallAgeMinutes,
    marginUsd: 100,
  });

  // Catches a `>` → `>=` slip: the copy promises "over 90 minutes", so a load sitting exactly on
  // the threshold must not be called stale.
  it("treats the threshold itself as not yet stale", () => {
    expect(isStaleCheckCall(row(STALE_CHECK_CALL_MINUTES))).toBe(false);
    expect(isStaleCheckCall(row(STALE_CHECK_CALL_MINUTES + 1))).toBe(true);
  });

  // Catches the shipped dataset losing the rows the page's emphasis and its screen-reader hint
  // both depend on.
  it("flags exactly the rows the manifest is meant to emphasise", () => {
    expect(BOARD_ROWS.filter(isStaleCheckCall).map((r) => r.ref)).toEqual([
      "LL-4818",
      "LL-4790",
    ]);
  });
});

describe("annotations", () => {
  const annotated = BOARD_ROWS.filter((row) => row.annotation);

  // Catches the drift back toward a feature section: annotations are marginalia on specific
  // rows, so if every row carries one the manifest has become a feature grid in a table.
  it("annotates a minority of rows, never all of them", () => {
    expect(annotated.length).toBeGreaterThan(0);
    expect(annotated.length).toBeLessThan(BOARD_ROWS.length / 2 + 1);
  });

  // Catches a duplicated annotation key, which would render the same marketing line twice.
  it("uses each annotation at most once", () => {
    const keys = annotated.map((row) => row.annotation);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Catches an annotation landing on a row that does not support its claim — the "late" note
  // talks about a truck being dark, so it must sit on the row that actually is.
  it("attaches the late annotation to a stale row", () => {
    const lateRow = BOARD_ROWS.find((row) => row.annotation === "late");
    expect(lateRow).toBeDefined();
    expect(lateRow!.status).toBe("late");
    expect(isStaleCheckCall(lateRow!)).toBe(true);
  });

  // Catches the same for the delivered note, which claims paperwork arrived with the delivery.
  it("attaches the delivered annotation to a delivered row", () => {
    const deliveredRow = BOARD_ROWS.find(
      (row) => row.annotation === "delivered"
    );
    expect(deliveredRow).toBeDefined();
    expect(deliveredRow!.status).toBe("delivered");
  });
});
