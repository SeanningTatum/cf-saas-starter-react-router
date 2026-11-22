/**
 * Security headers for every response: pages and API routes through
 * `workers/app.ts`, static assets through `public/_headers` (generated from
 * `assetHeadersFile()` below).
 *
 * How to allow a new host: docs/security-headers.md
 */

/** The allow-list. The ONE place to add a host. Keys are CSP directives. */
const CSP_SOURCES: Readonly<Record<string, ReadonlyArray<string>>> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  // `style` attributes and `<style>` tags (Radix, charts, Vite dev) cannot
  // carry a nonce, so styles keep 'unsafe-inline'. Never add a nonce here: a
  // nonce would switch 'unsafe-inline' off.
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  // Named hosts only: `https:` here would let an injected script send data
  // to any host through an image URL, which `connect-src 'self'` exists to
  // stop. The two GitHub hosts serve the kitchen-sink demo avatar.
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://github.com",
    "https://avatars.githubusercontent.com",
  ],
  "connect-src": ["'self'"],
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
    // Vite's HMR socket.
    if (name === "connect-src" && opts.dev) extra.push("ws:");
    return [name, ...sources, ...extra].join(" ");
  });
  if (!opts.dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
};

export const securityHeaders = (opts: HeaderOptions = {}): Record<string, string> => ({
  "Content-Security-Policy": buildCsp(opts),
  // Not in dev: a year-long pin on localhost would break other local
  // projects. No `includeSubDomains`: it would lock a fork out of any
  // http-only subdomain for a year (docs/security-headers.md).
  ...(opts.dev ? {} : { "Strict-Transport-Security": "max-age=31536000" }),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
});

/**
 * Returns a response that carries the headers (overwrites same-named ones).
 * Copies the response first, so it works when the input's headers are
 * immutable (for example `Response.redirect`).
 */
export const withSecurityHeaders = (response: Response, opts: HeaderOptions = {}): Response => {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders(opts))) {
    copy.headers.set(name, value);
  }
  return copy;
};

/**
 * The text of `public/_headers` (Cloudflare static-assets format). Static
 * assets skip the Worker, so they get the headers from this file instead.
 */
export const assetHeadersFile = (): string => {
  const lines = Object.entries(securityHeaders()).map(([name, value]) => `  ${name}: ${value}`);
  return [
    "# Generated from workers/security-headers.ts. Do not edit; refresh with: bunx vitest run workers/__tests__/security-headers.test.ts -u",
    "/*",
    ...lines,
    "",
  ].join("\n");
};
