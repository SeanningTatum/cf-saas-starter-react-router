import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { AnalyticsRepository } from "../analytics";
import { chainable, makeTestDatabase } from "@/services/database.test-layer";

const provideStub = (stub: unknown) =>
  AnalyticsRepository.Default.pipe(Layer.provide(makeTestDatabase(stub)));

describe("AnalyticsRepository.getUserStats", () => {
  it.effect("computes verificationRate as percent of total", () => {
    let call = 0;
    const counts = [
      [{ count: 100 }],
      [{ count: 75 }],
      [{ count: 5 }],
      [{ count: 2 }],
    ];
    const stub = {
      select: () => chainable(counts[call++]),
    };
    return Effect.gen(function* () {
      const repo = yield* AnalyticsRepository;
      const stats = yield* repo.getUserStats;
      expect(stats.totalUsers).toBe(100);
      expect(stats.verifiedUsers).toBe(75);
      expect(stats.bannedUsers).toBe(5);
      expect(stats.adminUsers).toBe(2);
      expect(stats.verificationRate).toBe(75);
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("returns 0 verificationRate when total is 0", () => {
    let call = 0;
    const counts = [[{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }]];
    const stub = { select: () => chainable(counts[call++]) };
    return Effect.gen(function* () {
      const repo = yield* AnalyticsRepository;
      const stats = yield* repo.getUserStats;
      expect(stats.verificationRate).toBe(0);
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("AnalyticsRepository.getRoleDistribution", () => {
  it.effect("capitalises role names", () => {
    const stub = {
      select: () =>
        chainable([
          { name: "user", value: 80 },
          { name: "admin", value: 5 },
        ]),
    };
    return Effect.gen(function* () {
      const repo = yield* AnalyticsRepository;
      const result = yield* repo.getRoleDistribution;
      expect(result).toEqual([
        { name: "User", value: 80 },
        { name: "Admin", value: 5 },
      ]);
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("AnalyticsRepository.getVerificationDistribution", () => {
  it.effect("returns Verified and Unverified buckets", () => {
    let call = 0;
    const counts = [[{ count: 70 }], [{ count: 30 }]];
    const stub = { select: () => chainable(counts[call++]) };
    return Effect.gen(function* () {
      const repo = yield* AnalyticsRepository;
      const result = yield* repo.getVerificationDistribution;
      expect(result).toEqual([
        { name: "Verified", value: 70 },
        { name: "Unverified", value: 30 },
      ]);
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("AnalyticsRepository.getRecentSignupsCount", () => {
  it.effect("returns zero when no rows", () => {
    const stub = { select: () => chainable([]) };
    return Effect.gen(function* () {
      const repo = yield* AnalyticsRepository;
      const n = yield* repo.getRecentSignupsCount({ days: 7 });
      expect(n).toBe(0);
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("returns count from first row", () => {
    const stub = { select: () => chainable([{ count: 12 }]) };
    return Effect.gen(function* () {
      const repo = yield* AnalyticsRepository;
      const n = yield* repo.getRecentSignupsCount({ days: 30 });
      expect(n).toBe(12);
    }).pipe(Effect.provide(provideStub(stub)));
  });
});
