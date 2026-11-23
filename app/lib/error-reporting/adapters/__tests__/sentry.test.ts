import { afterEach, describe, expect, it as itVitest, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { parseSentryDsn, sentryAdapter, toSentryEnvelope } from "../sentry";
import type { ErrorReport } from "../../adapter";
import { ExternalServiceError } from "@/models/errors/repository";

const fakeDsn = () => "https://abc123@o0.ingest.example.com/1";

const report = (over: Partial<ErrorReport> = {}): ErrorReport => ({
  id: "0123456789abcdef0123456789abcdef",
  timestamp: "2026-01-01T00:00:00.000Z",
  source: "trpc",
  kind: "defect",
  level: "error",
  name: "TypeError",
  message: "x is undefined",
  requestId: "req-1",
  userId: "u1",
  release: "v1.2.3",
  environment: "staging",
  ...over,
});

const adapter = () => {
  const dsn = parseSentryDsn(fakeDsn());
  expect(dsn).toBeDefined();
  return sentryAdapter({ dsn: dsn as NonNullable<typeof dsn> });
};

const stubFetch = (impl: () => Promise<{ ok: boolean; status: number }>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("parseSentryDsn", () => {
  itVitest(
    "reads the key and builds the envelope url, keeping a path prefix, so events reach the right project",
    () => {
      expect(parseSentryDsn(fakeDsn())).toEqual({
        dsn: fakeDsn(),
        publicKey: "abc123",
        envelopeUrl: "https://o0.ingest.example.com/api/1/envelope/",
      });
      expect(parseSentryDsn("https://abc123@sentry.example.com/relay/42")?.envelopeUrl).toBe(
        "https://sentry.example.com/relay/api/42/envelope/",
      );
    },
  );

  itVitest(
    "refuses an empty, non-URL, non-http, keyless or projectless DSN, so a bad config falls back instead of posting nowhere",
    () => {
      for (const dsn of [
        undefined,
        "",
        "not a dsn",
        "ftp://abc123@o0.ingest.example.com/1",
        "https://o0.ingest.example.com/1",
        "https://abc123@o0.ingest.example.com/",
      ]) {
        expect(parseSentryDsn(dsn)).toBeUndefined();
      }
    },
  );
});

describe("toSentryEnvelope", () => {
  itVitest(
    "is three JSON lines even when the message has a newline, so Sentry can parse the envelope",
    () => {
      const parts = toSentryEnvelope(report({ message: "line one\nline two" }), fakeDsn())
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(parts).toHaveLength(3);
      expect(parts[0]).toMatchObject({
        event_id: "0123456789abcdef0123456789abcdef",
        dsn: fakeDsn(),
      });
      expect(parts[1]).toEqual({ type: "event" });
    },
  );

  itVitest(
    "carries release, environment, level, user, request id and the exception, so an event is searchable",
    () => {
      const event = JSON.parse(toSentryEnvelope(report(), fakeDsn()).split("\n")[2] ?? "{}");

      expect(event).toMatchObject({
        release: "v1.2.3",
        environment: "staging",
        level: "error",
        user: { id: "u1" },
        tags: { request_id: "req-1" },
      });
      expect(event.exception.values[0]).toEqual({
        type: "TypeError",
        value: "x is undefined",
      });
    },
  );
});

describe("sentryAdapter.send", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.effect(
    "POSTs each report to the envelope url with the key in x-sentry-auth, so every report the service hands over reaches Sentry",
    () =>
      Effect.gen(function* () {
        const fetchFn = stubFetch(async () => ({ ok: true, status: 200 }));

        yield* adapter().send([report({ id: "a" }), report({ id: "c" })]);

        expect(fetchFn).toHaveBeenCalledTimes(2);
        const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://o0.ingest.example.com/api/1/envelope/");
        expect(init.method).toBe("POST");
        expect(new Headers(init.headers).get("x-sentry-auth")).toContain("sentry_key=abc123");
      }),
  );

  it.effect(
    "fails with ExternalServiceError on a non-2xx or a rejected fetch, so a dropped event is never counted as sent",
    () =>
      Effect.gen(function* () {
        stubFetch(async () => ({ ok: false, status: 429 }));
        const refused = yield* Effect.flip(adapter().send([report()]));
        expect(refused).toBeInstanceOf(ExternalServiceError);

        stubFetch(() => Promise.reject(new Error("offline")));
        const offline = yield* Effect.flip(adapter().send([report()]));
        expect(offline).toBeInstanceOf(ExternalServiceError);
      }),
  );
});

describe("parseSentryDsn, transport", () => {
  itVitest(
    "refuses a cleartext DSN except on localhost, so reports never cross the network unencrypted",
    () => {
      expect(parseSentryDsn("http://abc123@sentry.example.com/1")).toBeUndefined();
      expect(parseSentryDsn("http://abc123@localhost:9000/1")?.envelopeUrl).toBe(
        "http://localhost:9000/api/1/envelope/",
      );
    },
  );
});
