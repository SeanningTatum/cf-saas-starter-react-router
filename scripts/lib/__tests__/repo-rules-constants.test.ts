import { describe, expect, it } from "vitest";
import { CONFIG_PATH, PENDING_APPLIED_NOTICE, PENDING_KEY } from "../repo-rules-constants";

describe("repo-rules-constants", () => {
  it("tells the owner which key to delete and in which file once pending items are applied", () => {
    expect(PENDING_APPLIED_NOTICE).toContain(`"${PENDING_KEY}"`);
    expect(PENDING_APPLIED_NOTICE).toContain(CONFIG_PATH);
    expect(CONFIG_PATH).toBe(".github/repo-rules.json");
  });
});
