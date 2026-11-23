import { describe, expect, it } from "vitest";
import { FULL_TRAFFIC, ROLLOUT_STEPS, VERSION_ID_LINE, rollbackFailedLine, rolledBackLine, soakLine } from "../rollout-constants";

describe("rollout-constants", () => {
  it("climbs in rising steps that end at 100, so that each step sends more traffic than the last and the rollout finishes", () => {
    expect(ROLLOUT_STEPS.at(-1)).toBe(FULL_TRAFFIC);
    for (let i = 1; i < ROLLOUT_STEPS.length; i++) expect(ROLLOUT_STEPS[i]).toBeGreaterThan(ROLLOUT_STEPS[i - 1] ?? 0);
    expect(ROLLOUT_STEPS[0]).toBeLessThanOrEqual(25);
  });

  it("matches only a full version UUID after the upload label, so that a stray id elsewhere in the output is never deployed", () => {
    expect(VERSION_ID_LINE.exec("Worker Version ID: 22222222-2222-4222-8222-222222222222")?.[1]).toBe("22222222-2222-4222-8222-222222222222");
    expect(VERSION_ID_LINE.exec("Worker Version ID: 2222")).toBeNull();
  });

  it("says the soak in seconds, and says after a rollback that the database keeps its migration, so that nobody expects a schema undo", () => {
    expect(soakLine(60_000)).toContain("60 seconds");
    expect(rolledBackLine(10, "old")).toContain("database keeps any migration");
  });

  it("gives the exact command when the rollback fails, so that the person on call can paste it", () => {
    expect(rollbackFailedLine("abc")).toContain("bunx wrangler versions deploy abc@100% -y");
  });
});
