import { HTTP_TOO_MANY_REQUESTS, RATE_LIMITED_CODE } from "@/lib/constants/rate-limit";
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

export const authRefusalFor = (error: AuthErrorShape, captchaEnabled: boolean): AuthRefusal | null => {
  if (error.status === HTTP_TOO_MANY_REQUESTS || error.code === RATE_LIMITED_CODE) return "rate_limited";
  if (!captchaEnabled || error.code === undefined) return null;
  if (TURNSTILE_FAILED_CODES.includes(error.code)) return "captcha_failed";
  if (error.status === TURNSTILE_UNAVAILABLE_STATUS && error.code === TURNSTILE_UNAVAILABLE_CODE) {
    return "captcha_unavailable";
  }
  return null;
};
