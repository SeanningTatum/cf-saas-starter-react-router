import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  outputJsonSchema,
  prompt,
  SupportTicketInput,
} from "../prompt";

describe("prompt module invariants", () => {
  it("pins a real Workers AI model id", () => {
    expect(prompt.model).toBe("@cf/moonshotai/kimi-k2.5");
  });

  it("render produces exactly one user message with no sampling params", () => {
    const input = Schema.decodeUnknownSync(SupportTicketInput)({
      subject: "Refund for duplicate charge",
      body: "I was charged twice for March.",
      accountAgeDays: 410,
      priorTickets: 1,
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

  it("instructs the model that ticket text is untrusted data", () => {
    expect(prompt.system).toMatch(/[Uu]ntrusted/);
    expect(prompt.system).toContain("injectionDetected");
  });

  it("exports a JSON Schema object with the contract's properties", () => {
    expect(outputJsonSchema.type).toBe("object");
    const properties = outputJsonSchema.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([
      "category",
      "injectionDetected",
      "sentiment",
      "suggestedAction",
      "summary",
      "urgency",
    ]);
  });
});
