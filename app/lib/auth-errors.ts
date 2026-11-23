import {
  HTTP_TOO_MANY_REQUESTS,
  MS_PER_SECOND,
  RATE_LIMITED_CODE,
  RETRY_AFTER_DELAY_SECONDS,
  RETRY_AFTER_HEADER,
} from "@/lib/constants/rate-limit";
import {
  TURNSTILE_FAILED_CODES,
  TURNSTILE_UNAVAILABLE_CODE,
  TURNSTILE_UNAVAILABLE_STATUS,
} from "@/lib/constants/turnstile";

export type AuthRefusal = "rate_limited" | "captcha_failed" | "captcha_unavailable";

export interface AuthErrorShape {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

export const authRefusalFor = (
  error: AuthErrorShape,
  captchaEnabled: boolean,
): AuthRefusal | null => {
  if (error.status === HTTP_TOO_MANY_REQUESTS || error.code === RATE_LIMITED_CODE)
    return "rate_limited";
  if (!captchaEnabled || error.code === undefined) return null;
  if (TURNSTILE_FAILED_CODES.includes(error.code)) return "captcha_failed";
  if (error.status === TURNSTILE_UNAVAILABLE_STATUS && error.code === TURNSTILE_UNAVAILABLE_CODE) {
    return "captcha_unavailable";
  }
  return null;
};

export interface RefusedResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
}

const secondsUntil = (atMs: number, nowMs: number): number =>
  Math.ceil((atMs - nowMs) / MS_PER_SECOND);

export const retryWaitSeconds = (response: RefusedResponse, nowMs: number): number | null => {
  if (response.status !== HTTP_TOO_MANY_REQUESTS) return null;
  const header = response.headers.get(RETRY_AFTER_HEADER)?.trim() ?? "";
  const seconds = RETRY_AFTER_DELAY_SECONDS.test(header)
    ? Number(header)
    : secondsUntil(Date.parse(header), nowMs);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
};
