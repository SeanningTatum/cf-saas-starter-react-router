import {
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_REPORT_URL_LENGTH,
} from "@/lib/constants/error-reporting";
import { redactPath, redactWithin } from "@/lib/redact";
import type { ErrorLevel, ErrorReport, ErrorSource } from "./adapter";
import { classifyError } from "./classify";
import { clip } from "./text";

export interface ErrorCapture {
  readonly error: unknown;
  readonly source: ErrorSource;
  readonly level?: ErrorLevel;
  readonly requestId?: string;
  readonly url?: string;
}

export interface ReportStamp {
  readonly id: string;
  readonly timestamp: string;
  readonly release: string;
  readonly environment: string;
  readonly requestId?: string;
  readonly userId?: string;
  readonly method?: string;
  readonly path?: string;
}

export const withoutQuery = (url: string): string | undefined => {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return clip(
    `${parsed.origin}${redactPath(parsed.pathname)}`,
    MAX_REPORT_URL_LENGTH
  );
};

const present = <K extends string>(
  key: K,
  value: string | undefined
): { readonly [P in K]?: string } =>
  value === undefined ? {} : ({ [key]: value } as { readonly [P in K]: string });

const redacted = (text: string | undefined, max: number): string | undefined =>
  text === undefined ? undefined : redactWithin(text, max);

export const buildReport = (
  capture: ErrorCapture,
  stamp: ReportStamp
): ErrorReport => {
  const classified = classifyError(capture.error);
  return {
    id: stamp.id,
    timestamp: stamp.timestamp,
    source: capture.source,
    kind: classified.kind,
    level: capture.level ?? classified.level,
    name: redactWithin(classified.name, MAX_ERROR_NAME_LENGTH),
    message: redactWithin(classified.message, MAX_ERROR_MESSAGE_LENGTH),
    ...present("stack", redacted(classified.stack, MAX_ERROR_STACK_LENGTH)),
    ...present("tag", redacted(classified.tag, MAX_ERROR_NAME_LENGTH)),
    ...present("requestId", capture.requestId ?? stamp.requestId),
    ...present("userId", stamp.userId),
    release: stamp.release,
    environment: stamp.environment,
    ...present("method", stamp.method),
    ...present(
      "path",
      stamp.path === undefined
        ? undefined
        : clip(redactPath(stamp.path), MAX_REPORT_URL_LENGTH)
    ),
    ...present(
      "url",
      capture.url === undefined ? undefined : withoutQuery(capture.url)
    ),
  };
};
