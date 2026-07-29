import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  AdminInsightsInput,
  outputJsonSchema,
  prompt,
} from "../prompt";

describe("prompt module invariants", () => {
  it("pins a real Workers AI model id", () => {
    expect(prompt.model).toBe("@cf/moonshotai/kimi-k2.5");
  });

  it("render produces exactly one user message with no sampling params", () => {
    const input = Schema.decodeUnknownSync(AdminInsightsInput)({
      stats: {
        totalUsers: 10,
        verifiedUsers: 8,
        bannedUsers: 0,
        adminUsers: 1,
        verificationRate: 80,
      },
      growth: [{ date: "2026-07-22", count: 2 }],
      recentSignups7d: 2,
    });
    const messages = prompt.render(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain(JSON.stringify(input));
    expect(JSON.stringify(prompt)).not.toMatch(/temperature|top_p|top_k/);
  });

  it("keeps volatile data out of the system prompt", () => {
    expect(prompt.system).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prompt.system).not.toContain("{");
  });

  it("exports a JSON Schema object with the contract's properties", () => {
    expect(outputJsonSchema.type).toBe("object");
    const properties = outputJsonSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      "dataQuality",
      "headline",
      "suggestedActions",
      "trends",
    ]);
  });
});
