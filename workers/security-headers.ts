import { TURNSTILE_ORIGIN } from "@/lib/constants/turnstile";
import { BROWSER_REPORT_PATH, CSP_REPORT_GROUP } from "@/lib/constants/error-reporting";

const CSP_SOURCES: Readonly<Record<string, ReadonlyArray<string>>> = {
  "default-src": ["'self'"],
  "script-src": ["'self'", TURNSTILE_ORIGIN],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://github.com",
    "https://avatars.githubusercontent.com",
  ],
  "connect-src": ["'self'"],
  "frame-src": ["'self'", TURNSTILE_ORIGIN],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

export interface HeaderOptions {
  readonly nonce?: string;
  readonly dev?: boolean;
}

export const makeNonce = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
};

const buildCsp = (opts: HeaderOptions): string => {
  const directives = Object.entries(CSP_SOURCES).map(([name, sources]) => {
    const extra: string[] = [];
    if (name === "script-src" && opts.nonce) extra.push(`'nonce-${opts.nonce}'`);
    if (name === "connect-src" && opts.dev) extra.push("ws:");
    return [name, ...sources, ...extra].join(" ");
  });
  if (!opts.dev) directives.push("upgrade-insecure-requests");
  directives.push(`report-uri ${BROWSER_REPORT_PATH}`, `report-to ${CSP_REPORT_GROUP}`);
  return directives.join("; ");
};

export const securityHeaders = (opts: HeaderOptions = {}): Record<string, string> => ({
  "Content-Security-Policy": buildCsp(opts),
  "Reporting-Endpoints": `${CSP_REPORT_GROUP}="${BROWSER_REPORT_PATH}"`,
  ...(opts.dev ? {} : { "Strict-Transport-Security": "max-age=31536000" }),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
});

export const withSecurityHeaders = (response: Response, opts: HeaderOptions = {}): Response => {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders(opts))) {
    copy.headers.set(name, value);
  }
  return copy;
};

export const assetHeadersFile = (): string => {
  const lines = Object.entries(securityHeaders()).map(([name, value]) => `  ${name}: ${value}`);
  return [
    "# Generated from workers/security-headers.ts. Do not edit; refresh with: bunx vitest run workers/__tests__/security-headers.test.ts -u",
    "/*",
    ...lines,
    "",
  ].join("\n");
};
