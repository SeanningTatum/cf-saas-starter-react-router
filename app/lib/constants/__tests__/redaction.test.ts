import { describe, expect, it } from "vitest";
import {
  BEARER_PATTERN,
  EMAIL_PATTERN,
  SECRET_PAIR_PATTERN,
} from "../redaction";

describe("redaction patterns", () => {
  it("are global, so String.replace masks every match and not just the first", () => {
    for (const pattern of [EMAIL_PATTERN, BEARER_PATTERN, SECRET_PAIR_PATTERN]) {
      expect(pattern.flags).toContain("g");
    }
  });
});
