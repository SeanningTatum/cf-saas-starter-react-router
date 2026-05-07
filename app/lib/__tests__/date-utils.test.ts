import { describe, it, expect } from "vitest";
import { enUS } from "date-fns/locale";
import { formatDate, getDateFnsLocale } from "../date-utils";

describe("getDateFnsLocale", () => {
  it("returns enUS for 'en'", () => {
    expect(getDateFnsLocale("en")).toBe(enUS);
  });
  it("falls back to enUS for unknown locale", () => {
    expect(getDateFnsLocale("xx")).toBe(enUS);
  });
});

describe("formatDate", () => {
  it("formats a Date with the given pattern", () => {
    const date = new Date("2026-01-15T12:00:00Z");
    expect(formatDate(date, "yyyy-MM-dd", "en")).toBe("2026-01-15");
  });
  it("accepts a numeric timestamp", () => {
    const ts = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(formatDate(ts, "yyyy", "en")).toBe("2026");
  });
});
