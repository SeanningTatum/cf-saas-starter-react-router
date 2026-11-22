import { describe, expect, it } from "vitest";
import { activeSession, isBanActive } from "../ban";

const NOW = new Date("2030-06-15T12:00:00Z");
const PAST = new Date("2030-06-15T11:59:59Z");
const FUTURE = new Date("2030-06-15T12:00:01Z");

describe("isBanActive", () => {
  it.each([
    ["a ban with no expiry", { banned: true }, true],
    ["a ban with a null expiry", { banned: true, banExpires: null }, true],
    ["a ban that ends in the future", { banned: true, banExpires: FUTURE }, true],
    ["a ban that ends this very moment", { banned: true, banExpires: NOW }, true],
    ["a ban that already ended", { banned: true, banExpires: PAST }, false],
    ["no ban", { banned: false }, false],
    ["a null flag", { banned: null }, false],
    ["no flag at all", {}, false],
    ["an expiry on a user who is not banned", { banned: false, banExpires: FUTURE }, false],
  ])("%s -> %s", (_label, user, expected) => {
    expect(isBanActive(user, NOW)).toBe(expected);
  });

  it("keeps a ban active when its expiry is not a real date, so a bad value never frees the user", () => {
    expect(isBanActive({ banned: true, banExpires: new Date("not a date") }, NOW)).toBe(true);
  });

  it("reads an expiry that arrives as an ISO string (cookie cache shape) instead of crashing", () => {
    const fromCache = { banned: true, banExpires: PAST.toISOString() as unknown as Date };
    expect(isBanActive(fromCache, NOW)).toBe(false);
  });
});

describe("activeSession", () => {
  const sessionOf = (user: { banned?: boolean | null; banExpires?: Date | null }) => ({
    session: { id: "s1" },
    user: { id: "u1", ...user },
  });

  it("returns null for no session", () => {
    expect(activeSession(null, NOW)).toBeNull();
  });

  it("drops the session of a user whose ban is active", () => {
    expect(activeSession(sessionOf({ banned: true }), NOW)).toBeNull();
    expect(activeSession(sessionOf({ banned: true, banExpires: FUTURE }), NOW)).toBeNull();
  });

  it("hands back the same session object for a user with no ban", () => {
    const live = sessionOf({ banned: false });
    expect(activeSession(live, NOW)).toBe(live);
  });

  it("lets the session through once the ban has run out", () => {
    const expired = sessionOf({ banned: true, banExpires: PAST });
    expect(activeSession(expired, NOW)).toBe(expired);
  });
});
