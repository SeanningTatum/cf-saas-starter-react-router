import { describe, expect, it } from "vitest";
import { Either, Schema } from "effect";
import { AnalyticsEvent } from "../events";

describe("AnalyticsEvent", () => {
  it("decodes user_banned and rejects a wrong property type, so a catalog edit cannot loosen a type, rename the event (splitting the history) or drop it from the union", () => {
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
