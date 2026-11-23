import { describe, expect, it } from "vitest";
import {
  BROWSER_REPORT_WINDOW_LIMIT,
  REMOTE_REPORT_WINDOW_LIMIT,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_REPORT_BODY_BYTES,
  MAX_REPORT_URL_LENGTH,
  MAX_UTF8_BYTES_PER_CODE_UNIT,
  REQUEST_ID_PATTERN,
} from "../error-reporting";

describe("REQUEST_ID_PATTERN", () => {
  it("takes a trace id and a cf-ray, so a real request id is never dropped from a browser report", () => {
    expect(REQUEST_ID_PATTERN.test("4bf92f3577b34da6a3ce929d0e0e4736")).toBe(true);
    expect(REQUEST_ID_PATTERN.test("8f1a2b3c4d5e6f70-SJC")).toBe(true);
  });

  it("refuses spaces, slashes and 65 characters, so a crafted id cannot reach a log line or header", () => {
    expect(REQUEST_ID_PATTERN.test("abc def")).toBe(false);
    expect(REQUEST_ID_PATTERN.test("abc/def")).toBe(false);
    expect(REQUEST_ID_PATTERN.test("a".repeat(64))).toBe(true);
    expect(REQUEST_ID_PATTERN.test("a".repeat(65))).toBe(false);
  });
});

describe("report caps", () => {
  it("fit inside the body limit even when every character is three UTF-8 bytes, so a report clipped to the caps is never refused for size", () => {
    expect(
      (MAX_ERROR_STACK_LENGTH +
        MAX_ERROR_MESSAGE_LENGTH +
        MAX_ERROR_NAME_LENGTH +
        MAX_REPORT_URL_LENGTH) *
        MAX_UTF8_BYTES_PER_CODE_UNIT,
    ).toBeLessThan(MAX_REPORT_BODY_BYTES);
  });
});

describe("report budgets", () => {
  it("leave room for server reports after a full window of browser reports, so a flood of browser posts cannot use up every send to the backend", () => {
    expect(REMOTE_REPORT_WINDOW_LIMIT).toBeGreaterThan(BROWSER_REPORT_WINDOW_LIMIT);
  });
});
