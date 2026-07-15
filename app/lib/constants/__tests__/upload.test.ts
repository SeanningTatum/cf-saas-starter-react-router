import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_CONTENT_TYPES,
  isAllowedUploadContentType,
} from "../upload";

describe("MAX_UPLOAD_SIZE_BYTES", () => {
  it("is 10MB", () => {
    expect(MAX_UPLOAD_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("isAllowedUploadContentType", () => {
  it("returns true for every entry in the allowlist", () => {
    for (const type of ALLOWED_UPLOAD_CONTENT_TYPES) {
      expect(isAllowedUploadContentType(type)).toBe(true);
    }
  });

  it("returns false for a disallowed content type", () => {
    expect(isAllowedUploadContentType("application/x-msdownload")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isAllowedUploadContentType("")).toBe(false);
  });
});
