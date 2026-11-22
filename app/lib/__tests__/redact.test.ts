import { describe, expect, it } from "vitest";
import { hashEmail, redactPath, redactText, redactWithin } from "../redact";
import {
  EMAIL_HASH_LENGTH,
  EMAIL_HASH_PREFIX,
  REDACTED,
} from "@/lib/constants/redaction";

const webCryptoHash = async (email: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email.trim().toLowerCase())
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return EMAIL_HASH_PREFIX + hex.slice(0, EMAIL_HASH_LENGTH);
};

const timeOf = (run: () => void): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe("hashEmail", () => {
  it("matches the Web Crypto SHA-256 of the trimmed lower-case address, so a sync hash cannot drift from the one Workers computes", async () => {
    expect(hashEmail("user@example.com")).toBe(
      await webCryptoHash("user@example.com")
    );
    expect(hashEmail("user@example.com")).toMatch(
      new RegExp(`^${EMAIL_HASH_PREFIX}[0-9a-f]{${EMAIL_HASH_LENGTH}}$`)
    );
  });

  it("gives one hash for any case or spacing of one address, so a user cannot show up as two people", () => {
    expect(hashEmail("User@Example.com ")).toBe(hashEmail("user@example.com"));
  });
});

describe("redactText", () => {
  it("replaces every address in a string, so the second email of a message cannot leak", () => {
    const out = redactText("from user@example.com to admin@example.org");

    expect(out).not.toContain("@");
    expect(out).toBe(
      `from ${hashEmail("user@example.com")} to ${hashEmail("admin@example.org")}`
    );
  });

  it("masks a bearer token, so a logged auth header cannot hand out a session", () => {
    expect(redactText("sent bearer abc.def-123")).toBe(`sent bearer ${REDACTED}`);
  });

  it("masks password, access_token and secret values, so a form or query dump cannot leak them", () => {
    expect(redactText("password=hunter2 next")).toBe(`password=${REDACTED} next`);
    expect(redactText("?access_token=xyz789&page=2")).toBe(
      `?access_token=${REDACTED}&page=2`
    );
    expect(redactText("secret: s3cr3t")).toBe(`secret: ${REDACTED}`);
  });

  it("leaves ordinary text alone, so a report stays readable", () => {
    const text = "Loaded 3 rows from the user table in 12ms";

    expect(redactText(text)).toBe(text);
  });

  it("finishes fast on a long string with no @, so a huge message cannot stall the worker", () => {
    const text = "a".repeat(100_000);

    expect(timeOf(() => redactText(text))).toBeLessThan(500);
  });

  it("finishes fast on a long run of a@a@, so a crafted message cannot backtrack the email regex", () => {
    const text = "a@".repeat(50_000);

    expect(timeOf(() => redactText(text))).toBeLessThan(500);
  });
});

describe("redactText, credential shapes", () => {
  it("masks a JSON-quoted password with a space in it, so an error that embeds a request body cannot leak its tail", () => {
    expect(redactText('{"password":"hunter two","page":2}')).toBe(
      `{"password":${REDACTED},"page":2}`
    );
  });

  it("masks api key, session and credential values, so keys named other than token cannot leak", () => {
    expect(redactText("x-api-key=abc123 api_key: def456")).toBe(
      `x-api-key=${REDACTED} api_key: ${REDACTED}`
    );
    expect(redactText("session=s3ss10n")).toBe(`session=${REDACTED}`);
  });

  it("masks the whole value of an authorization or cookie header, so a basic credential or a second cookie cannot leak", () => {
    expect(redactText("Authorization: Basic dXNlcjpwYXNz\nnext line")).toBe(
      `Authorization: ${REDACTED}\nnext line`
    );
    expect(redactText("cookie: theme=dark; sid=abc123")).toBe(
      `cookie: ${REDACTED}`
    );
  });

  it("masks a bare JWT, so a token pasted into a message cannot leak", () => {
    const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJl";

    expect(redactText(`got ${jwt} back`)).toBe(`got ${REDACTED} back`);
  });

  it("masks the bound values of a failed query but keeps the SQL, so row data cannot reach a report", () => {
    const stack =
      "Error: Failed query: select * from user where email = ?\nparams: fake-row-value,42\n    at run (db.ts:1:1)";

    const out = redactText(stack);

    expect(out).not.toContain("fake-row-value");
    expect(out).toBe(
      `Error: Failed query: select * from user where email = ?\nparams: ${REDACTED}`
    );
  });
});

describe("redactPath", () => {
  it("masks a long opaque segment, so a reset token in a path cannot reach a report", () => {
    expect(redactPath("/reset/9f8e7d6c5b4a39281706f5e4d3c2b1a0/confirm")).toBe(
      `/reset/${REDACTED}/confirm`
    );
  });

  it("keeps short ids and long word slugs, so a report still says which page failed", () => {
    expect(redactPath("/admin/users/42")).toBe("/admin/users/42");
    expect(redactPath("/blog/how-to-build-a-starter-kit-fast")).toBe(
      "/blog/how-to-build-a-starter-kit-fast"
    );
  });
});

describe("redactWithin", () => {
  it("cuts the input before it redacts, so a megabyte message cannot spend the request's CPU", () => {
    const huge = "word-like-run_".repeat(100_000);

    expect(timeOf(() => redactWithin(huge, 1024))).toBeLessThan(100);
    expect(redactWithin(huge, 1024)).toHaveLength(1024);
  });

  it("redacts before the final cut, so a value that starts inside the cap is not cut into a readable half", () => {
    const text = `${"a".repeat(1000)} password=hunter2hunter2hunter2hunter2`;

    expect(redactWithin(text, 1024)).not.toContain("hunter2");
  });
});

describe("redactText, cost and edge shapes", () => {
  it("masks every bound value even when one holds a line that looks like a stack frame, so a crafted value cannot cut the mask short", () => {
    const text =
      "Failed query: select 1\nparams: first\n    at fake (x.ts:1:1),second-fake-value";

    expect(redactText(text)).toBe(`Failed query: select 1\nparams: ${REDACTED}`);
  });

  it("leaves the word params alone outside a failed query, so an ordinary message keeps its stack", () => {
    const text = "invalid params: page\n    at run (x.ts:1:1)";

    expect(redactText(text)).toBe(text);
  });

  it("masks the password in a connection string, so a database URL in an error cannot leak it", () => {
    expect(redactText("connect postgres://app:fake-pw@db.example.com/main")).toBe(
      `connect postgres://app:${REDACTED}@db.example.com/main`
    );
  });

  it("stays fast on text built to make each pattern backtrack, so one posted report cannot spend the request's CPU", () => {
    const size = 16_384;
    const fill = (unit: string) => unit.repeat(Math.ceil(size / unit.length));
    const hostile = [
      `Failed query: x\nparams:${"\n".repeat(size)}`,
      fill("token"),
      fill(`${"a".repeat(30)}token`),
      fill("a@b."),
      fill('token="'),
      fill("://a:"),
      fill("authorization"),
    ];

    for (const text of hostile) {
      expect(timeOf(() => redactText(text))).toBeLessThan(500);
    }
  });
});
