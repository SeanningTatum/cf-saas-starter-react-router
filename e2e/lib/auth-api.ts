import type { APIRequestContext, APIResponse } from "@playwright/test";
import { CLIENT_IP_HEADER } from "../../app/lib/constants/auth";
import { TURNSTILE_TEST_TOKEN, TURNSTILE_TOKEN_HEADER } from "../../app/lib/constants/turnstile";
import { API_PATHS, SESSION_COOKIE_FRAGMENT, SET_COOKIE_HEADER } from "./values";

export interface AppApiCaller {
  readonly origin: string;
  readonly clientIp: string;
  readonly turnstileToken?: string | null;
}

const appApiHeaders = ({ origin, clientIp, turnstileToken = TURNSTILE_TEST_TOKEN }: AppApiCaller) => ({
  Origin: origin,
  [CLIENT_IP_HEADER]: clientIp,
  ...(turnstileToken === null ? {} : { [TURNSTILE_TOKEN_HEADER]: turnstileToken }),
});

export const postSignIn = (
  request: APIRequestContext,
  caller: AppApiCaller,
  credentials: { readonly email: string; readonly password: string },
): Promise<APIResponse> =>
  request.post(API_PATHS.signIn, { headers: appApiHeaders(caller), data: credentials });

export const postSignUp = (
  request: APIRequestContext,
  caller: AppApiCaller,
  account: { readonly name: string; readonly email: string; readonly password: string },
): Promise<APIResponse> =>
  request.post(API_PATHS.signUp, { headers: appApiHeaders(caller), data: account });

export const postAppApi = (
  request: APIRequestContext,
  caller: AppApiCaller,
  path: string,
  data: Record<string, unknown>,
): Promise<APIResponse> => request.post(path, { headers: appApiHeaders(caller), data });

export const sessionCookiesSetBy = (response: APIResponse): ReadonlyArray<string> =>
  response
    .headersArray()
    .filter(({ name, value }) => name.toLowerCase() === SET_COOKIE_HEADER && value.includes(SESSION_COOKIE_FRAGMENT))
    .map(({ value }) => value);
