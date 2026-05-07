import { Schema } from "effect";

export const DateRangeInput = Schema.Struct({
  startDate: Schema.DateFromSelf,
  endDate: Schema.DateFromSelf,
});
export type DateRangeInput = typeof DateRangeInput.Type;

export const GetRecentSignupsCountInput = Schema.Struct({
  days: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(365),
    Schema.optionalWith({ default: () => 7 })
  ),
});
export type GetRecentSignupsCountInput = typeof GetRecentSignupsCountInput.Type;

export const UserGrowthPoint = Schema.Struct({
  date: Schema.String,
  count: Schema.Number,
});
export type UserGrowthPoint = typeof UserGrowthPoint.Type;

export const UserStats = Schema.Struct({
  totalUsers: Schema.Number,
  verifiedUsers: Schema.Number,
  bannedUsers: Schema.Number,
  adminUsers: Schema.Number,
  verificationRate: Schema.Number,
});
export type UserStats = typeof UserStats.Type;

export const DistributionPoint = Schema.Struct({
  name: Schema.String,
  value: Schema.Number,
});
export type DistributionPoint = typeof DistributionPoint.Type;
