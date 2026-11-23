import { describe, it, expect } from "vitest";
import {
  CONTENT_LENGTH_HEADER,
  MAX_UPLOAD_REQUEST_BYTES,
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_CONTENT_TYPES,
  declaredPayloadBytes,
  declaresOversizedUpload,
  uploadKeyFor,
  uploadPrefixFor,
  isAllowedUploadContentType,
  matchesMagicBytes,
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

  it("rejects image/svg+xml (stored-XSS vector, deliberately excluded)", () => {
    expect(isAllowedUploadContentType("image/svg+xml")).toBe(false);
  });
});

describe("matchesMagicBytes", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const WEBP = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const HTML = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);

  it("accepts each allowed type with its real signature", () => {
    expect(matchesMagicBytes("image/png", PNG)).toBe(true);
    expect(matchesMagicBytes("image/jpeg", JPEG)).toBe(true);
    expect(matchesMagicBytes("image/gif", GIF)).toBe(true);
    expect(matchesMagicBytes("image/webp", WEBP)).toBe(true);
    expect(matchesMagicBytes("application/pdf", PDF)).toBe(true);
  });

  it("rejects a spoofed declared type (HTML payload claiming image/jpeg)", () => {
    expect(matchesMagicBytes("image/jpeg", HTML)).toBe(false);
  });

  it("rejects mismatched signatures across types", () => {
    expect(matchesMagicBytes("image/png", JPEG)).toBe(false);
    expect(matchesMagicBytes("application/pdf", PNG)).toBe(false);
  });

  it("rejects RIFF container that is not WEBP", () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(matchesMagicBytes("image/webp", wav)).toBe(false);
  });

  it("rejects truncated/empty input", () => {
    expect(matchesMagicBytes("image/png", new Uint8Array([0x89, 0x50]))).toBe(false);
    expect(matchesMagicBytes("image/jpeg", new Uint8Array([]))).toBe(false);
  });
});

describe("declaresOversizedUpload", () => {
  const withLength = (value?: string) =>
    new Headers(value === undefined ? {} : { [CONTENT_LENGTH_HEADER]: value });

  it("refuses a declared length past the file cap plus the multipart allowance", () => {
    expect(declaresOversizedUpload(withLength(String(MAX_UPLOAD_REQUEST_BYTES + 1)))).toBe(true);
  });

  it("lets a full-size file through with its multipart envelope, so the largest allowed file is not refused at the door", () => {
    expect(MAX_UPLOAD_REQUEST_BYTES).toBeGreaterThan(MAX_UPLOAD_SIZE_BYTES);
    expect(declaresOversizedUpload(withLength(String(MAX_UPLOAD_REQUEST_BYTES)))).toBe(false);
    expect(declaresOversizedUpload(withLength(String(MAX_UPLOAD_SIZE_BYTES + 1)))).toBe(false);
  });

  it.each([
    ["absent", undefined],
    ["blank", " "],
    ["not a number", "lots"],
    ["negative", "-1"],
    ["fractional", "1.5e9"],
  ])(
    "leaves a request whose length is %s to the body read, which checks the file itself",
    (_label, value) => {
      expect(declaresOversizedUpload(withLength(value))).toBe(false);
    },
  );
});

describe("uploadKeyFor", () => {
  it("puts the owner's id in the key and under the owner's prefix, so one prefix lists exactly one user's objects", () => {
    expect(uploadKeyFor("u1", "abc")).toBe("uploads/u1/abc");
    expect(uploadKeyFor("u1", "abc").startsWith(uploadPrefixFor("u1"))).toBe(true);
    expect(uploadKeyFor("u1", "abc").startsWith(uploadPrefixFor("u"))).toBe(false);
  });
});

describe("declaredPayloadBytes", () => {
  it("is the declared length less the multipart allowance, never negative, so a pre-read quota check never refuses a body that would fit", () => {
    const at = (value: string) => new Headers({ [CONTENT_LENGTH_HEADER]: value });
    expect(declaredPayloadBytes(at(String(64 * 1024 + 500)))).toBe(500);
    expect(declaredPayloadBytes(at("10"))).toBe(0);
  });

  it("is 0 when the header is missing or not a number", () => {
    expect(declaredPayloadBytes(new Headers())).toBe(0);
    expect(declaredPayloadBytes(new Headers({ [CONTENT_LENGTH_HEADER]: "abc" }))).toBe(0);
  });
});
