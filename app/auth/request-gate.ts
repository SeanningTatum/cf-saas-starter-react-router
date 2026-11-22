import { Effect } from "effect";
import { CLIENT_IP_HEADER } from "@/lib/constants/auth";
import {
  AUTH_API_PATH_PREFIX,
  AUTH_RULE_PATH_PREFIXES,
  HEX_RADIX,
  HTTP_TOO_MANY_REQUESTS,
  IPV4_OCTET_BITS,
  IPV4_OCTET_MAX,
  IPV4_PATTERN,
  IPV4_SEPARATOR,
  IPV6_HEXTET_COUNT,
  IPV6_HEXTET_PATTERN,
  IPV6_MAPPED_IPV4_MARKER,
  IPV6_MAPPED_IPV4_MARKER_INDEX,
  IPV6_SEPARATOR,
  IPV6_SUBNET_HEXTETS,
  IPV6_SUBNET_SUFFIX,
  IPV6_ZERO_RUN,
  IPV6_ZONE_SEPARATOR,
  PATH_SEPARATOR,
  PERCENT_ENCODED_BYTE,
  RATE_LIMITED_CODE,
  RATE_LIMITED_MESSAGE,
  REPEATED_SLASHES,
  RETRY_AFTER_HEADER,
  SHARED_CLIENT_KEY,
  TURNSTILE_GUARDED_RULES,
  UNLIMITED_METHODS,
  URL_UNRESERVED_CHARACTER,
} from "@/lib/constants/rate-limit";
import { TURNSTILE_OFF_WARNING } from "@/lib/constants/turnstile";
import type { RateLimitError } from "@/models/errors/rate-limit";
import { AuthApi } from "@/services/auth";
import { RateLimiter, type RateLimitRule } from "@/services/rate-limit";

const ipv4Octets = (value: string): ReadonlyArray<number> | null => {
  if (!IPV4_PATTERN.test(value)) return null;
  const octets = value.split(IPV4_SEPARATOR).map(Number);
  return octets.every((octet) => octet <= IPV4_OCTET_MAX) ? octets : null;
};

const hextetPairOf = (octets: ReadonlyArray<number>): string => {
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  const hextet = (high: number, low: number) => ((high << IPV4_OCTET_BITS) | low).toString(HEX_RADIX);
  return `${hextet(a, b)}${IPV6_SEPARATOR}${hextet(c, d)}`;
};

const withIpv4TailAsHextets = (address: string): string | null => {
  const cut = address.lastIndexOf(IPV6_SEPARATOR);
  const tail = address.slice(cut + 1);
  if (!tail.includes(IPV4_SEPARATOR)) return address;
  const octets = ipv4Octets(tail);
  return octets === null ? null : `${address.slice(0, cut + 1)}${hextetPairOf(octets)}`;
};

const groupsOf = (part: string | undefined): ReadonlyArray<string> =>
  part === undefined || part === "" ? [] : part.split(IPV6_SEPARATOR);

const ipv6Hextets = (value: string): ReadonlyArray<number> | null => {
  const address = withIpv4TailAsHextets(value.split(IPV6_ZONE_SEPARATOR)[0] ?? "");
  if (address === null) return null;
  const halves = address.split(IPV6_ZERO_RUN);
  if (halves.length > 2) return null;
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1]);
  const missing = IPV6_HEXTET_COUNT - head.length - tail.length;
  const compressed = halves.length === 2;
  if (compressed ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  return groups.every((group) => IPV6_HEXTET_PATTERN.test(group))
    ? groups.map((group) => parseInt(group, HEX_RADIX))
    : null;
};

const mappedIpv4 = (hextets: ReadonlyArray<number>): string | null => {
  const isMapped =
    hextets.slice(0, IPV6_MAPPED_IPV4_MARKER_INDEX).every((hextet) => hextet === 0) &&
    hextets[IPV6_MAPPED_IPV4_MARKER_INDEX] === IPV6_MAPPED_IPV4_MARKER;
  if (!isMapped) return null;
  const [high = 0, low = 0] = hextets.slice(IPV6_MAPPED_IPV4_MARKER_INDEX + 1);
  return [high >> IPV4_OCTET_BITS, high & IPV4_OCTET_MAX, low >> IPV4_OCTET_BITS, low & IPV4_OCTET_MAX].join(
    IPV4_SEPARATOR
  );
};

export const addressKey = (raw: string): string => {
  const ipv4 = ipv4Octets(raw);
  if (ipv4 !== null) return ipv4.join(IPV4_SEPARATOR);
  const hextets = ipv6Hextets(raw);
  if (hextets === null) return raw;
  const subnet = hextets
    .slice(0, IPV6_SUBNET_HEXTETS)
    .map((hextet) => hextet.toString(HEX_RADIX))
    .join(IPV6_SEPARATOR);
  return mappedIpv4(hextets) ?? `${subnet}${IPV6_SUBNET_SUFFIX}`;
};

export const clientKey = (request: Request): string => {
  const ip = request.headers.get(CLIENT_IP_HEADER)?.trim();
  return ip === undefined || ip === "" ? SHARED_CLIENT_KEY : addressKey(ip);
};

const decodeUnreserved = (path: string): string =>
  path.replace(PERCENT_ENCODED_BYTE, (encoded, hex: string) => {
    const character = String.fromCharCode(parseInt(hex, HEX_RADIX));
    return URL_UNRESERVED_CHARACTER.test(character) ? character : encoded;
  });

const normalizedPath = (request: Request): string => {
  const collapsed = decodeUnreserved(new URL(request.url).pathname)
    .toLowerCase()
    .replace(REPEATED_SLASHES, PATH_SEPARATOR);
  return collapsed.length > 1 && collapsed.endsWith(PATH_SEPARATOR) ? collapsed.slice(0, -1) : collapsed;
};

export const authRuleFor = (request: Request): RateLimitRule | null => {
  if (UNLIMITED_METHODS.includes(request.method.toUpperCase())) return null;
  const path = `${normalizedPath(request)}${PATH_SEPARATOR}`;
  const named = AUTH_RULE_PATH_PREFIXES.find(({ prefix }) => path.startsWith(prefix));
  if (named !== undefined) return named.rule;
  return path.startsWith(AUTH_API_PATH_PREFIX) ? "authApi" : null;
};

export const guardAuthRequest = (request: Request): Effect.Effect<void, RateLimitError, RateLimiter> => {
  const rule = authRuleFor(request);
  return rule === null
    ? Effect.void
    : Effect.flatMap(RateLimiter, (limiter) => limiter.check(rule, clientKey(request)));
};

export const rateLimitedResponse = (error: RateLimitError): Response =>
  Response.json(
    { code: RATE_LIMITED_CODE, message: RATE_LIMITED_MESSAGE },
    {
      status: HTTP_TOO_MANY_REQUESTS,
      headers: { [RETRY_AFTER_HEADER]: String(error.retryAfterSeconds) },
    }
  );

const warnWhenTurnstileOff = (rule: RateLimitRule | null, dev: boolean): Effect.Effect<void, never, AuthApi> =>
  dev || rule === null || !TURNSTILE_GUARDED_RULES.includes(rule)
    ? Effect.void
    : Effect.flatMap(AuthApi, ({ turnstileSiteKey }) =>
        turnstileSiteKey === null ? Effect.logWarning(TURNSTILE_OFF_WARNING) : Effect.void
      );

export const authGate = (
  request: Request,
  dev: boolean
): Effect.Effect<Response | null, never, RateLimiter | AuthApi> =>
  guardAuthRequest(request).pipe(
    Effect.zipRight(warnWhenTurnstileOff(authRuleFor(request), dev)),
    Effect.as(null),
    Effect.catchTag("RateLimitError", (error) => Effect.succeed(rateLimitedResponse(error)))
  );
