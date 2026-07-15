import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { PaginationInput } from "../pagination";

const decode = <A, I>(s: Schema.Schema<A, I>) => Schema.decodeUnknownEither(s);

describe("PaginationInput", () => {
  it("applies defaults for page and limit", () => {
    const result = Schema.decodeUnknownSync(PaginationInput)({});
    expect(result.page).toBe(0);
    expect(result.limit).toBe(10);
  });

  it("accepts a valid explicit page and limit", () => {
    expect(decode(PaginationInput)({ page: 3, limit: 25 })._tag).toBe("Right");
  });

  it("rejects a negative page", () => {
    expect(decode(PaginationInput)({ page: -1 })._tag).toBe("Left");
  });

  it("rejects a non-integer page", () => {
    expect(decode(PaginationInput)({ page: 1.5 })._tag).toBe("Left");
  });

  it("rejects limit below 1", () => {
    expect(decode(PaginationInput)({ limit: 0 })._tag).toBe("Left");
  });

  it("rejects limit above 100", () => {
    expect(decode(PaginationInput)({ limit: 101 })._tag).toBe("Left");
  });

  it("accepts the boundary values 1 and 100", () => {
    expect(decode(PaginationInput)({ limit: 1 })._tag).toBe("Right");
    expect(decode(PaginationInput)({ limit: 100 })._tag).toBe("Right");
  });
});
