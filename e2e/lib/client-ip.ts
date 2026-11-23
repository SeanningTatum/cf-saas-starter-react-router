import { expect, test, type BrowserContext } from "@playwright/test";
import { CLIENT_IP_HEADER } from "../../app/lib/constants/auth";
import { IPV6_SEPARATOR, IPV6_SUBNET_HEXTETS } from "../../app/lib/constants/rate-limit";
import {
  API_PATHS,
  CLIENT_IPS,
  IPV6_DOCUMENTATION_PREFIX,
  IPV6_GROUP_RADIX,
  IPV6_HOST_SUFFIX,
  type SpecFile,
} from "./values";

export const appOrigin = (baseURL: string | undefined): string => {
  expect(baseURL, "playwright.config.ts sets no baseURL").toBeTruthy();
  return new URL(baseURL ?? "").origin;
};

export const sendClientIpOnAppApiRequests = (
  context: BrowserContext,
  origin: string,
  clientIp: string,
) =>
  context.route(
    (url) => url.origin === origin && url.pathname.startsWith(API_PATHS.prefix),
    (route) =>
      route.fallback({ headers: { ...route.request().headers(), [CLIENT_IP_HEADER]: clientIp } }),
  );

export const useClientIpPerFile = (file: SpecFile) => {
  test.beforeEach(async ({ context, baseURL }) => {
    await sendClientIpOnAppApiRequests(context, appOrigin(baseURL), CLIENT_IPS[file]);
  });
  return CLIENT_IPS[file];
};

export const freshDocumentationIpv6 = (): string => {
  const prefix = IPV6_DOCUMENTATION_PREFIX.split(IPV6_SEPARATOR);
  const subnetGroups = new Uint16Array(IPV6_SUBNET_HEXTETS - prefix.length);
  const groups = Array.from(crypto.getRandomValues(subnetGroups), (group) =>
    group.toString(IPV6_GROUP_RADIX),
  );
  return [...prefix, ...groups].join(IPV6_SEPARATOR) + IPV6_HOST_SUFFIX;
};
