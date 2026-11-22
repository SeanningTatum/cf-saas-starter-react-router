import { describe, expect, it } from "vitest";
import { hashEmail, redactFields, redactText } from "../redact";
import {
  BINARY,
  CIRCULAR,
  MAX_LOG_TEXT_LENGTH,
  MAX_REDACTION_DEPTH,
  MAX_REDACTION_ITEMS,
  REDACTED,
  SECRET_WORDS,
  SENSITIVE_KEY_PATTERN,
  TOO_DEEP,
} from "@/lib/constants/redaction";

const SENSITIVE_KEYS = [
  "password",
  "Authorization",
  "set-cookie",
  "accessToken",
  "client_secret",
  "x-api-key",
];

const plainValues = (): Record<string, unknown> =>
  Object.fromEntries(SENSITIVE_KEYS.map((key) => [key, "plain-value"]));

const maskedValues = (): Record<string, unknown> =>
  Object.fromEntries(SENSITIVE_KEYS.map((key) => [key, REDACTED]));

const walk = (value: unknown, key: string, steps: number): unknown => {
  let node = value;
  for (let step = 0; step < steps; step += 1) {
    node = (node as Record<string, unknown>)[key];
  }
  return node;
};

describe("redactFields, sensitive keys", () => {
  it("masks each sensitive key at the top level by its name alone, so a field called password cannot reach a log line", () => {
    expect(redactFields(plainValues())).toEqual(maskedValues());
  });

  it("masks the whole value of a sensitive key even when it is an object, so the parts of a credential cannot leak one by one", () => {
    expect(
      redactFields({ authorization: { scheme: "Basic", value: "plain-value" } })
    ).toEqual({ authorization: REDACTED });
  });

  it("masks sensitive keys three levels down, so a credential inside a nested request dump cannot leak", () => {
    expect(redactFields({ a: { b: { c: plainValues() } } })).toEqual({
      a: { b: { c: maskedValues() } },
    });
  });

  it("masks sensitive keys in each object of an array, so a list of headers cannot leak", () => {
    expect(
      redactFields({ list: [plainValues(), { name: "kept" }] })
    ).toEqual({ list: [maskedValues(), { name: "kept" }] });
  });
});

describe("redactFields, values", () => {
  it("hashes an email and masks a bearer token under an innocent key, so a value that names no secret still cannot leak one", () => {
    expect(
      redactFields({ note: "from user@example.com", header: "Bearer abc" })
    ).toEqual({
      note: `from ${hashEmail("user@example.com")}`,
      header: `Bearer ${REDACTED}`,
    });
  });

  it("returns dates, numbers, booleans and null as they were, so a log line keeps its timings and flags", () => {
    const at = new Date(Date.UTC(2026, 0, 2));

    const out = redactFields({ at, count: 3, ratio: 0.5, ok: false, none: null });

    expect(out.at).toBe(at);
    expect(out).toEqual({ at, count: 3, ratio: 0.5, ok: false, none: null });
  });

  it("keeps an Error's name, message and stack and redacts them, so a logged error is not an empty object and cannot leak an email", () => {
    const error = new TypeError("failed for user@example.com");

    const out = redactFields({ error });

    expect(out.error).toEqual({
      name: "TypeError",
      message: `failed for ${hashEmail("user@example.com")}`,
      stack: expect.stringContaining(hashEmail("user@example.com")),
    });
    expect(JSON.stringify(out)).not.toContain("user@example.com");
  });

  it("cuts a long string to the log cap, so one huge value cannot bloat a line", () => {
    const out = redactFields({ body: "a".repeat(MAX_LOG_TEXT_LENGTH * 3) });

    expect(out.body).toHaveLength(MAX_LOG_TEXT_LENGTH);
  });
});

describe("redactFields, shapes", () => {
  it("marks a cycle instead of looping, so a self-referencing object cannot hang or crash the log sink", () => {
    const node: Record<string, unknown> = { name: "loop" };
    node.self = node;
    const fields: Record<string, unknown> = { node };
    fields.root = fields;

    const out = redactFields(fields);

    expect(out).toEqual({ node: { name: "loop", self: CIRCULAR }, root: CIRCULAR });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("keeps every level up to the depth cap and cuts the next one, so a deep chain cannot spend the request's CPU", () => {
    let chain: Record<string, unknown> = { leaf: "bottom" };
    for (let level = 0; level < MAX_REDACTION_DEPTH * 3; level += 1) {
      chain = { next: chain };
    }

    const out = redactFields(chain);

    expect(walk(out, "next", MAX_REDACTION_DEPTH - 1)).toEqual({
      next: TOO_DEEP,
    });
    expect(JSON.stringify(out)).not.toContain("bottom");
  });

  it("leaves the input as it was, so a caller's headers object is not masked for the rest of the request", () => {
    const input = {
      headers: { authorization: "Bearer abc" },
      users: [{ email: "user@example.com" }],
    };
    const before = JSON.stringify(input);

    redactFields(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it("redacts an object shared by two keys in both places, so a value seen twice is not marked circular", () => {
    const shared = { token: "plain-value", label: "x" };

    expect(redactFields({ a: shared, b: shared })).toEqual({
      a: { token: REDACTED, label: "x" },
      b: { token: REDACTED, label: "x" },
    });
  });
});

describe("redactFields, size and odd values", () => {
  it("writes at most the capped number of items of an array, so a huge list in a log call cannot spend the request's memory", () => {
    const out = redactFields({ ids: Array.from({ length: MAX_REDACTION_ITEMS + 50 }, (_, i) => i) });

    expect(out.ids).toHaveLength(MAX_REDACTION_ITEMS);
  });

  it("writes a marker for bytes, so an uploaded file's buffer is not expanded index by index into the log", () => {
    const out = redactFields({ body: new Uint8Array(4096), raw: new ArrayBuffer(8) });

    expect(out).toEqual({ body: BINARY, raw: BINARY });
  });

  it("turns a bigint into text, so the JSON line can still be written", () => {
    const out = redactFields({ count: 12n });

    expect(JSON.stringify(out)).toBe('{"count":"12"}');
  });
});

describe("the key list and the text list", () => {
  const sample = (word: string) => word.replace("[_-]?", "_");

  it("mask the same words, so a secret named in one list cannot slip through the other", () => {
    for (const word of SECRET_WORDS) {
      const key = sample(word);

      expect(SENSITIVE_KEY_PATTERN.test(key), key).toBe(true);
      expect(redactText(`${key}=plain-value`), key).toBe(`${key}=${REDACTED}`);
    }
  });

  it("mask session, credential, jwt, otp and signature keys, so a Better Auth session logged whole does not show its secrets", () => {
    const out = redactFields({
      session: { id: "s1" },
      credentialId: "c1",
      jwt: "a.b.c",
      otp: "123456",
      signature: "sig",
    });

    expect(Object.values(out)).toEqual(Array.from({ length: 5 }, () => REDACTED));
  });
});

describe("redactText, strings with no address in them", () => {
  it("skips the email pass when there is no @, so a long id or path costs nothing extra on every log line", () => {
    const text = "a.".repeat(8_192);
    const start = performance.now();

    expect(redactText(text)).toBe(text);

    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("redactFields, property names", () => {
  it("hashes an email used as a key, so counts grouped by address do not print the addresses", () => {
    const out = redactFields({ byUser: { "user@example.com": 3 } });

    expect(out).toEqual({ byUser: { [hashEmail("user@example.com")]: 3 } });
  });

  it("leaves an ordinary key as it is, so log search by field name still works", () => {
    expect(Object.keys(redactFields({ requestId: "r1", durationMs: 4, "db.entity": "user" }))).toEqual([
      "requestId",
      "durationMs",
      "db.entity",
    ]);
  });
});
