import { describe, expect, it } from "vitest";
import { D1_MAX_BOUND_VARIABLES, MAX_BULK_USER_IDS } from "../db";

describe("MAX_BULK_USER_IDS", () => {
  it("is 50, half of D1's 100 bound variables per statement, so a bulk UPDATE still has room to bind its SET columns", () => {
    expect(D1_MAX_BOUND_VARIABLES).toBe(100);
    expect(MAX_BULK_USER_IDS).toBe(50);
  });
});
