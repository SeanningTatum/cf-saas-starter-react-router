import { Effect } from "effect";
import {
  LOCAL_HOSTNAMES,
  SENTRY_CLIENT,
  SENTRY_PROTOCOL_VERSION,
  SENTRY_TIMEOUT_MS,
} from "@/lib/constants/error-reporting";
import { ExternalServiceError } from "@/models/errors/repository";
import type { ErrorReport, ErrorReporterAdapter } from "../adapter";

export interface SentryDsn {
  readonly dsn: string;
  readonly publicKey: string;
  readonly envelopeUrl: string;
}

export const parseSentryDsn = (dsn: string | undefined): SentryDsn | undefined => {
  if (!dsn || !URL.canParse(dsn)) return undefined;
  const url = new URL(dsn);
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  const isSecure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOCAL_HOSTNAMES.includes(url.hostname));
  if (!isSecure || !url.username || !projectId) return undefined;
  const prefix = segments.map((segment) => `/${segment}`).join("");
  return {
    dsn,
    publicKey: url.username,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  };
};

const tags = (report: ErrorReport): Record<string, string> => ({
  source: report.source,
  kind: report.kind,
  ...(report.tag === undefined ? {} : { error_tag: report.tag }),
  ...(report.requestId === undefined ? {} : { request_id: report.requestId }),
});

const toSentryEvent = (report: ErrorReport) => ({
  event_id: report.id,
  timestamp: report.timestamp,
  platform: "javascript",
  level: report.level,
  release: report.release,
  environment: report.environment,
  exception: { values: [{ type: report.name, value: report.message }] },
  tags: tags(report),
  ...(report.userId === undefined ? {} : { user: { id: report.userId } }),
  ...(report.method === undefined || report.path === undefined
    ? {}
    : { transaction: `${report.method} ${report.path}` }),
  extra: {
    ...(report.stack === undefined ? {} : { stack: report.stack }),
    ...(report.url === undefined ? {} : { url: report.url }),
  },
});

export const toSentryEnvelope = (report: ErrorReport, dsn: string): string =>
  [
    { event_id: report.id, sent_at: report.timestamp, dsn },
    { type: "event" },
    toSentryEvent(report),
  ]
    .map((part) => JSON.stringify(part))
    .join("\n");

export const sentryAdapter = (config: { readonly dsn: SentryDsn }): ErrorReporterAdapter => {
  const sendOne = (report: ErrorReport) =>
    Effect.tryPromise({
      try: () =>
        fetch(config.dsn.envelopeUrl, {
          method: "POST",
          signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
          headers: {
            "content-type": "application/x-sentry-envelope",
            "x-sentry-auth": `Sentry sentry_version=${SENTRY_PROTOCOL_VERSION}, sentry_client=${SENTRY_CLIENT}, sentry_key=${config.dsn.publicKey}`,
          },
          body: toSentryEnvelope(report, config.dsn.dsn),
        }),
      catch: (cause) => new ExternalServiceError({ service: "sentry", cause }),
    }).pipe(
      Effect.filterOrFail(
        (response) => response.ok,
        (response) =>
          new ExternalServiceError({
            service: "sentry",
            cause: `status ${response.status}`,
          }),
      ),
      Effect.asVoid,
    );

  return {
    name: "sentry",
    send: (batch) => Effect.forEach(batch, sendOne, { discard: true }),
  };
};
