import { describe, expect, it } from "vitest";
import { LOCALE_COOKIE_MAX_AGE_SECONDS } from "../i18n";

describe("LOCALE_COOKIE_MAX_AGE_SECONDS", () => {
  it("keeps the locale choice for one 365-day year", () => {
    expect(LOCALE_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
  });
});
