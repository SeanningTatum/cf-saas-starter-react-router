import { describe, it, expect } from "vitest";
import {
  BOARD_ROWS,
  LOAD_STATUSES,
  STALE_CHECK_CALL_MINUTES,
  STATUS_DOT,
  boardFilters,
  isStaleCheckCall,
  type BoardRow,
} from "../board-data";

/**
 * The `/demo` surface exists to prove the design guardrail in `.brain/rules/frontend.md`:
 * research drives structure, the repo's tokens own colour. These tests pin the parts of that
 * claim that code can actually break.
 */

describe("boardFilters", () => {
  // Catches: someone adds a row (or a status) to BOARD_ROWS and the pill counts go stale
  // because they were hardcoded instead of derived.
  it("derives counts from the rows it is given, not from a constant", () => {
    const rows: BoardRow[] = [
      {
        ref: "T-1",
        lane: "A → B",
        driver: "X",
        status: "rolling",
        checkCallAgeMinutes: 5,
        marginUsd: 100,
      },
      {
        ref: "T-2",
        lane: "B → C",
        driver: "Y",
        status: "rolling",
        checkCallAgeMinutes: 5,
        marginUsd: 100,
      },
      {
        ref: "T-3",
        lane: "C → D",
        driver: "Z",
        status: "late",
        checkCallAgeMinutes: 300,
        marginUsd: 100,
      },
    ];

    expect(boardFilters(rows)).toEqual([
      { key: "all", count: 3 },
      { key: "rolling", count: 2 },
      { key: "late", count: 1 },
      { key: "delivered", count: 0 },
    ]);
  });

  // Catches: the "All" pill drifting away from the real row count on the shipped dataset.
  it("reports every shipped row under the All pill", () => {
    const [all, ...statuses] = boardFilters();

    expect(all).toEqual({ key: "all", count: BOARD_ROWS.length });
    expect(statuses.reduce((sum, f) => sum + f.count, 0)).toBe(
      BOARD_ROWS.length
    );
  });
});

describe("STATUS_DOT", () => {
  // Catches: a new status added without a dot mapping, which renders an invisible indicator.
  it("maps every declared status", () => {
    for (const status of LOAD_STATUSES) {
      expect(STATUS_DOT[status]).toBeTruthy();
    }
  });

  // Catches the guardrail this whole surface demonstrates: a hardcoded colour sneaking into
  // the board. Dots must be semantic/chart token classes — never a literal hex, rgb or oklch.
  it("only uses semantic token classes — never a raw colour", () => {
    for (const className of Object.values(STATUS_DOT)) {
      expect(className).toMatch(
        /^bg-(chart-[1-5]|destructive|primary|muted-foreground)$/
      );
    }
  });

  // Catches colour creep: `rolling` is the majority state and must stay neutral, so the two
  // states a dispatcher actually needs to spot keep their signal value.
  it("spends colour only on the states that need spotting", () => {
    expect(STATUS_DOT.rolling).toBe("bg-muted-foreground");
    expect(STATUS_DOT.late).toBe("bg-destructive");
    expect(STATUS_DOT.delivered).not.toBe(STATUS_DOT.rolling);
  });
});

describe("isStaleCheckCall", () => {
  const row = (checkCallAgeMinutes: number): BoardRow => ({
    ref: "T-1",
    lane: "A → B",
    driver: "X",
    status: "rolling",
    checkCallAgeMinutes,
    marginUsd: 100,
  });

  // Catches a `>` → `>=` slip: the copy on the page promises "over 90 minutes", so a load
  // sitting exactly at the threshold must not be highlighted as stale.
  it("treats the threshold itself as not yet stale", () => {
    expect(isStaleCheckCall(row(STALE_CHECK_CALL_MINUTES))).toBe(false);
    expect(isStaleCheckCall(row(STALE_CHECK_CALL_MINUTES + 1))).toBe(true);
  });

  // Catches: the shipped dataset losing its one stale row, which would leave the board's
  // highlight state (and the feature copy describing it) unexercised in the browser walk.
  it("flags exactly the rows the shipped board is meant to highlight", () => {
    expect(BOARD_ROWS.filter(isStaleCheckCall).map((r) => r.ref)).toEqual([
      "LL-4818",
      "LL-4790",
    ]);
  });
});
