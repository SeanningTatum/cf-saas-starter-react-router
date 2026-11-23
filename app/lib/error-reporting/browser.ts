import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  BROWSER_ERROR_EVENT,
  BROWSER_REJECTION_EVENT,
  BROWSER_REPORT_CONTENT_TYPE,
  BROWSER_REPORT_METHOD,
  BROWSER_REPORT_PATH,
  FINGERPRINT_SEPARATOR,
  FIRST_SERVER_ERROR_STATUS,
  MAX_BROWSER_REPORTS_PER_PAGE,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_REPORT_URL_LENGTH,
  REQUEST_ID_PATTERN,
  ROUTE_ERROR_RESPONSE_NAME,
  STACK_LINE_BREAK,
  UNKNOWN_ERROR_MESSAGE,
  UNKNOWN_ERROR_NAME,
  URL_SUFFIX_PATTERN,
} from "@/lib/constants/error-reporting";
import type {
  BrowserErrorPayload,
  BrowserErrorSource,
} from "@/lib/error-reporting/browser-payload";
import { clip, isObject } from "@/lib/error-reporting/text";

interface PageInfo {
  readonly url: string;
  readonly requestId?: string;
}

interface BrowserReporterDeps {
  readonly send: (payload: BrowserErrorPayload) => void;
  readonly page: () => PageInfo;
}

interface ListenerTarget {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
}

const readData = (value: unknown, key: string): unknown => {
  if (value instanceof Error) return Reflect.get(value, key);
  let node: object | null = isObject(value) ? value : null;
  while (node !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key);
    if (descriptor !== undefined) return descriptor.value;
    node = Object.getPrototypeOf(node);
  }
  return undefined;
};

const readText = (value: unknown, key: string): string | undefined => {
  const found = readData(value, key);
  return typeof found === "string" && found !== "" ? found : undefined;
};

const routeResponseOf = (
  error: unknown,
): { readonly status: number; readonly statusText: string } | undefined => {
  const status = readData(error, "status");
  const statusText = readData(error, "statusText");
  return typeof status === "number" && typeof statusText === "string"
    ? { status, statusText }
    : undefined;
};

export const toBrowserPayload = (
  error: unknown,
  source: BrowserErrorSource,
  page: PageInfo,
): BrowserErrorPayload => {
  const response = routeResponseOf(error);
  const name =
    readText(error, "name") ??
    (response === undefined ? UNKNOWN_ERROR_NAME : ROUTE_ERROR_RESPONSE_NAME);
  const message =
    (typeof error === "string" && error !== "" ? error : undefined) ??
    readText(error, "message") ??
    (response === undefined
      ? UNKNOWN_ERROR_MESSAGE
      : `${response.status} ${response.statusText}`.trim());
  const stack = readText(error, "stack");
  const url = clip(page.url.split(URL_SUFFIX_PATTERN)[0] ?? "", MAX_REPORT_URL_LENGTH);
  const requestId =
    page.requestId !== undefined && REQUEST_ID_PATTERN.test(page.requestId)
      ? page.requestId
      : undefined;
  return {
    source,
    name: clip(name, MAX_ERROR_NAME_LENGTH),
    message: clip(message, MAX_ERROR_MESSAGE_LENGTH),
    ...(stack === undefined ? {} : { stack: clip(stack, MAX_ERROR_STACK_LENGTH) }),
    url,
    ...(requestId === undefined ? {} : { requestId }),
  };
};

const fingerprintOf = (payload: BrowserErrorPayload): string =>
  [payload.name, payload.message, payload.stack?.split(STACK_LINE_BREAK)[0] ?? ""].join(
    FINGERPRINT_SEPARATOR,
  );

export const makeBrowserReporter = (deps: BrowserReporterDeps) => {
  const seenObjects = new WeakSet<object>();
  const seenFingerprints = new Set<string>();
  return {
    report: (error: unknown, source: BrowserErrorSource): void => {
      if (seenFingerprints.size >= MAX_BROWSER_REPORTS_PER_PAGE) return;
      if (isObject(error)) {
        if (seenObjects.has(error)) return;
        seenObjects.add(error);
      }
      const payload = toBrowserPayload(error, source, deps.page());
      const fingerprint = fingerprintOf(payload);
      if (seenFingerprints.has(fingerprint)) return;
      seenFingerprints.add(fingerprint);
      deps.send(payload);
    },
  };
};

export const sendBrowserReport = (payload: BrowserErrorPayload): void => {
  fetch(BROWSER_REPORT_PATH, {
    method: BROWSER_REPORT_METHOD,
    keepalive: true,
    headers: { "content-type": BROWSER_REPORT_CONTENT_TYPE },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
};

const readPage = (): PageInfo => {
  const requestId = document.documentElement.dataset.requestId;
  return {
    url: location.href,
    ...(requestId === undefined ? {} : { requestId }),
  };
};

const reporter = makeBrowserReporter({
  send: sendBrowserReport,
  page: readPage,
});

export const reportHandledError = (error: unknown): void => reporter.report(error, "handled");

export const reportRecoverableError = (error: unknown): void =>
  reporter.report(error, "recoverable");

const installedTargets = new WeakSet<object>();

export const installBrowserErrorReporting = (target: ListenerTarget = window): void => {
  if (installedTargets.has(target)) return;
  installedTargets.add(target);
  target.addEventListener(BROWSER_ERROR_EVENT, (event) => {
    const { error, message } = event as ErrorEvent;
    reporter.report(error ?? message, "window");
  });
  target.addEventListener(BROWSER_REJECTION_EVENT, (event) => {
    reporter.report((event as PromiseRejectionEvent).reason, "rejection");
  });
};

export const shouldReportBoundaryError = (error: unknown, serverRendered: unknown): boolean => {
  if (error === serverRendered) return false;
  const response = routeResponseOf(error);
  return response === undefined || response.status >= FIRST_SERVER_ERROR_STATUS;
};

const subscribeToNothing = () => () => undefined;
const clientSnapshot = () => false;
const hydrationSnapshot = () => true;

export const useReportBoundaryError = (error: unknown): void => {
  const hydrating = useSyncExternalStore(subscribeToNothing, clientSnapshot, hydrationSnapshot);
  const serverRendered = useRef<unknown>(undefined);
  if (hydrating && serverRendered.current === undefined) {
    serverRendered.current = error;
  }
  useEffect(() => {
    if (shouldReportBoundaryError(error, serverRendered.current)) {
      reporter.report(error, "boundary");
    }
  }, [error]);
};
