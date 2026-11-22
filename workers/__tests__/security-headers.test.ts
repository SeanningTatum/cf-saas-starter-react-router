import { describe, expect, it } from "vitest";
import { BROWSER_REPORT_PATH, CSP_REPORT_GROUP } from "@/lib/constants/error-reporting";
import {
  assetHeadersFile,
  makeNonce,
  securityHeaders,
  withSecurityHeaders,
} from "../security-headers";
import { TURNSTILE_ORIGIN } from "@/lib/constants/turnstile";

const NONCE = "dGVzdC1ub25jZS0xMjM0NQ==";

describe("securityHeaders", () => {
  it("sets the exact production header set, so no silent loosening of the policy passes (update it with -u, see docs/security-headers.md)", () => {
    expect(securityHeaders({ nonce: NONCE })).toMatchInlineSnapshot(`
      {
        "Content-Security-Policy": "default-src 'self'; script-src 'self' https://challenges.cloudflare.com 'nonce-dGVzdC1ub25jZS0xMjM0NQ=='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://github.com https://avatars.githubusercontent.com; connect-src 'self'; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests; report-uri /api/browser-report; report-to csp",
        "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Reporting-Endpoints": "csp="/api/browser-report"",
        "Strict-Transport-Security": "max-age=31536000",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      }
    `);
  });

  it("differs in dev only by ws: in connect-src, no upgrade-insecure-requests and no HSTS (catches an HSTS pin on localhost)", () => {
    const { "Strict-Transport-Security": _hsts, ...prod } = securityHeaders({ nonce: NONCE });
    expect(securityHeaders({ nonce: NONCE, dev: true })).toEqual({
      ...prod,
      "Content-Security-Policy": prod["Content-Security-Policy"]
        ?.replace("connect-src 'self'", "connect-src 'self' ws:")
        ?.replace("; upgrade-insecure-requests", ""),
    });
  });

  it("sends CSP violations to the browser report endpoint in prod and dev, so that a blocked script or host is never silent", () => {
    for (const dev of [false, true]) {
      const headers = securityHeaders({ nonce: NONCE, dev });
      const directives = headers["Content-Security-Policy"]?.split("; ") ?? [];
      expect(directives).toContain(`report-uri ${BROWSER_REPORT_PATH}`);
      expect(directives).toContain(`report-to ${CSP_REPORT_GROUP}`);
      expect(headers["Reporting-Endpoints"]).toBe(`${CSP_REPORT_GROUP}="${BROWSER_REPORT_PATH}"`);
    }
  });

  it("without a nonce allows only same-origin and Turnstile scripts (catches an empty or literal 'nonce-undefined')", () => {
    const csp = securityHeaders()["Content-Security-Policy"];
    expect(csp).toContain(`script-src 'self' ${TURNSTILE_ORIGIN};`);
    expect(csp).not.toContain("nonce-");
  });

  it("lets the Turnstile widget load its script and frame, and nothing more from its host", () => {
    const directives = (securityHeaders()["Content-Security-Policy"] ?? "").split("; ");
    const withTurnstile = directives.filter((d) => d.includes(TURNSTILE_ORIGIN)).map((d) => d.split(" ")[0]);
    expect(withTurnstile).toEqual(["script-src", "frame-src"]);
    expect(directives).toContain(`frame-src 'self' ${TURNSTILE_ORIGIN}`);
  });
});

describe("makeNonce", () => {
  it("returns 16 random bytes as base64, new each call (catches a fixed or short nonce)", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(atob(a)).toHaveLength(16);
    expect(makeNonce()).not.toBe(a);
  });
});

describe("withSecurityHeaders", () => {
  it("keeps status, body and unrelated headers while overwriting a weaker X-Frame-Options (catches a route that re-allows framing)", async () => {
    const input = new Response("hello", {
      status: 201,
      headers: {
        "X-Frame-Options": "SAMEORIGIN",
        "Set-Cookie": "session=abc; HttpOnly",
        "Content-Type": "text/plain",
      },
    });
    const out = withSecurityHeaders(input, { nonce: NONCE });
    expect(out.status).toBe(201);
    expect(await out.text()).toBe("hello");
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
    expect(out.headers.get("Set-Cookie")).toBe("session=abc; HttpOnly");
    expect(out.headers.get("Content-Type")).toBe("text/plain");
    expect(out.headers.get("Content-Security-Policy")).toContain(`'nonce-${NONCE}'`);
  });

  it("works on a response with immutable headers (catches a TypeError on redirects)", () => {
    const out = withSecurityHeaders(Response.redirect("https://example.com/", 302));
    expect(out.status).toBe(302);
    expect(out.headers.get("Location")).toBe("https://example.com/");
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("assetHeadersFile", () => {
  it("matches public/_headers (catches static assets drifting from the Worker's headers)", async () => {
    await expect(assetHeadersFile()).toMatchFileSnapshot("../../public/_headers");
  });
});
