import { describe, expect, it } from "vitest";
import { Either, Schema } from "effect";
import { AnalyticsEvent } from "../events";

describe("AnalyticsEvent", () => {
  it("decodes user_banned and rejects a wrong property type", () => {
    // Catches: a catalog edit loosening a property type, renaming the event
    // (which splits the provider's history), or dropping it from the union.
    const ok = {
      _tag: "user_banned",
      distinctId: "a",
      targetUserId: "u",
      hasReason: true,
      hasExpiry: false,
    };
    const decode = Schema.decodeUnknownEither(AnalyticsEvent);
    expect(Either.isRight(decode(ok))).toBe(true);
    expect(Either.isLeft(decode({ ...ok, hasReason: "yes" }))).toBe(true);
  });
});
