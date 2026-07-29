import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { WorkersAi, type WorkersAiShape } from "@/services/ai";
import { AiOutputError } from "@/models/errors/ai";
import { generateAdminInsights } from "../run";

const input = {
  stats: {
    totalUsers: 100,
    verifiedUsers: 80,
    bannedUsers: 2,
    adminUsers: 1,
    verificationRate: 80,
  },
  growth: [{ date: "2026-07-22", count: 5 }],
  recentSignups7d: 5,
};

const modelOutput = {
  headline: "Steady signup flow continues",
  trends: [{ label: "Signups", direction: "flat", detail: "5 this week" }],
  suggestedActions: ["Keep monitoring"],
  dataQuality: "sufficient",
};

const stubLayer = (runJson: WorkersAiShape["runJson"]) =>
  Layer.succeed(WorkersAi, { runJson });

const runWith = (runJson: WorkersAiShape["runJson"]) =>
  Effect.exit(generateAdminInsights(input)).pipe(
    Effect.provide(stubLayer(runJson)),
    Effect.runPromise
  );

const expectAiOutputError = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(AiOutputError);
      expect((failure.value as AiOutputError).reason).toBe(reason);
      expect((failure.value as AiOutputError).promptId).toBe("admin-insights");
    }
  }
};

describe("generateAdminInsights", () => {
  it("decodes a JSON-string response", async () => {
    const exit = await runWith(() => Effect.succeed(JSON.stringify(modelOutput)));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.headline).toBe(modelOutput.headline);
    }
  });

  it("accepts an already-parsed object response", async () => {
    const exit = await runWith(() => Effect.succeed(modelOutput));
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("fails with invalid_json on an unparseable string", async () => {
    const exit = await runWith(() => Effect.succeed("not json {"));
    expectAiOutputError(exit, "invalid_json");
  });

  it("fails with empty_response on undefined/null/empty", async () => {
    for (const raw of [undefined, null, ""]) {
      const exit = await runWith(() => Effect.succeed(raw));
      expectAiOutputError(exit, "empty_response");
    }
  });

  it("fails with schema_violation on a contract breach", async () => {
    const exit = await runWith(() =>
      Effect.succeed({ ...modelOutput, dataQuality: "amazing" })
    );
    expectAiOutputError(exit, "schema_violation");
  });
});
