import { describe, expect, it } from "vitest";
import { securityHeaders } from "../security-headers";

const NONCE = "dGVzdC1ub25jZS0xMjM0NQ==";

const directive = (csp: string | undefined, name: string): string[] =>
  (csp ?? "")
    .split("; ")
    .find((d) => d.startsWith(`${name} `))
    ?.split(" ")
    .slice(1) ?? [];

describe("the CSP rules docs/security-headers.md explains", () => {
  it("keeps 'unsafe-inline' in style-src and never puts the nonce there, since a nonce would switch 'unsafe-inline' off and break style attributes", () => {
    for (const dev of [false, true]) {
      const styleSrc = directive(
        securityHeaders({ nonce: NONCE, dev })["Content-Security-Policy"],
        "style-src",
      );
      expect(styleSrc).toContain("'unsafe-inline'");
      expect(styleSrc.some((source) => source.startsWith("'nonce-"))).toBe(false);
    }
  });

  it("names every img-src host and never allows a bare scheme, so an injected script cannot send data out through an image URL", () => {
    const imgSrc = directive(
      securityHeaders({ nonce: NONCE })["Content-Security-Policy"],
      "img-src",
    );
    expect(imgSrc).not.toContain("https:");
    expect(imgSrc).not.toContain("http:");
    expect(imgSrc).not.toContain("*");
    expect(directive(securityHeaders()["Content-Security-Policy"], "connect-src")).toEqual([
      "'self'",
    ]);
  });

  it("pins HSTS for one year without includeSubDomains, so a fork's http-only subdomain is not locked out", () => {
    expect(securityHeaders({ nonce: NONCE })["Strict-Transport-Security"]).toBe("max-age=31536000");
  });
});
