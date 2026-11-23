import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { AnalyticsRepository } from "../analytics";
import { makeTestDatabase } from "@/services/database.test-layer";
import { QueryError } from "@/models/errors/repository";

const throwingStub = {
  select: () => {
    throw new Error("boom");
  },
};

const failing = AnalyticsRepository.Default.pipe(Layer.provide(makeTestDatabase(throwingStub)));

const window = { startDate: new Date("2024-01-01"), endDate: new Date("2024-01-31") };

const queries: Record<string, (repo: AnalyticsRepository) => Effect.Effect<unknown, QueryError>> = {
  getUserGrowth: (repo: AnalyticsRepository) => repo.getUserGrowth(window),
  getUserStats: (repo: AnalyticsRepository) => repo.getUserStats,
  getRoleDistribution: (repo: AnalyticsRepository) => repo.getRoleDistribution,
  getVerificationDistribution: (repo: AnalyticsRepository) => repo.getVerificationDistribution,
  getRecentSignupsCount: (repo: AnalyticsRepository) => repo.getRecentSignupsCount({ days: 7 }),
};

describe("AnalyticsRepository maps a throwing driver to QueryError", () => {
  it.effect.each(Object.entries(queries))(
    "%s fails with QueryError when select throws, so a driver failure is a tagged error and not a defect (the results on real rows are tested through the procedures, on the seeded database)",
    ([, query]) =>
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        expect(yield* Effect.flip(query(repo))).toBeInstanceOf(QueryError);
      }).pipe(Effect.provide(failing)),
  );
});
