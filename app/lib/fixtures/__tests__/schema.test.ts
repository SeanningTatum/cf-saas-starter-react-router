import { Either, ParseResult, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Scenario, UserFixture } from "../schema";

const user = (overrides: Record<string, unknown> = {}) => ({
  id: "seed-a",
  name: "A",
  email: "a@preview.local",
  role: "user",
  emailVerified: true,
  banned: false,
  banReason: null,
  createdAtMs: 1,
  ...overrides,
});

const scenarioError = (users: ReadonlyArray<unknown>): string => {
  const result = Schema.decodeUnknownEither(Scenario)({ name: "base", description: "d", users });
  return Either.isLeft(result) ? ParseResult.TreeFormatter.formatErrorSync(result.left) : "decoded";
};

const decodesUser = (input: unknown): boolean =>
  Either.isRight(Schema.decodeUnknownEither(UserFixture)(input));

describe("Scenario", () => {
  it("decodes fixtures with distinct ids and emails", () => {
    expect(scenarioError([user(), user({ id: "seed-b", email: "b@preview.local" })])).toBe(
      "decoded",
    );
  });

  it("rejects two fixtures with one id and names the id, so a restore cannot hit a primary key clash halfway", () => {
    expect(scenarioError([user(), user({ email: "b@preview.local" })])).toContain(
      "two fixtures share the id seed-a",
    );
  });

  it("rejects two fixtures with one email and names the email, so a restore cannot hit the unique email index", () => {
    expect(scenarioError([user(), user({ id: "seed-b" })])).toContain(
      "two fixtures share the email a@preview.local",
    );
  });
});

describe("UserFixture", () => {
  it("rejects an id without the seed- prefix, since the restore only deletes seed-% rows and would leave it behind", () => {
    expect(decodesUser(user({ id: "admin" }))).toBe(false);
    expect(decodesUser(user({ id: "Seed-admin" }))).toBe(false);
  });

  it("rejects an email outside @preview.local, so a fixture can never claim a real person's address", () => {
    expect(decodesUser(user({ email: "a@example.com" }))).toBe(false);
    expect(decodesUser(user({ email: "a@preview.local.example.com" }))).toBe(false);
    expect(decodesUser(user({ email: "a@sub.preview.local" }))).toBe(false);
    expect(decodesUser(user({ email: "a@preview.local" }))).toBe(true);
  });
});
