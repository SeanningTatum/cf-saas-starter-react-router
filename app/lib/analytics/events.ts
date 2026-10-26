import { Schema } from "effect";

// The event catalog: one TaggedStruct per event. `_tag` is the event name.
const UserBanned = Schema.TaggedStruct("user_banned", {
  distinctId: Schema.String,
  targetUserId: Schema.String,
  hasReason: Schema.Boolean,
  hasExpiry: Schema.Boolean,
});

export const AnalyticsEvent = Schema.Union(UserBanned);
export type AnalyticsEvent = typeof AnalyticsEvent.Type;
