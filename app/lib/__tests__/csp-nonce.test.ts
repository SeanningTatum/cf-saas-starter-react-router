import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NonceContext, useNonce } from "../csp-nonce";

const ShowNonce = () => createElement("span", null, useNonce() ?? "none");

describe("useNonce", () => {
  it("returns the provided nonce inside the provider (catches a broken nonce hand-off to root.tsx)", () => {
    const html = renderToStaticMarkup(
      createElement(NonceContext.Provider, { value: "abc123" }, createElement(ShowNonce))
    );
    expect(html).toBe("<span>abc123</span>");
  });

  it("returns undefined outside the provider (catches a made-up default nonce)", () => {
    expect(renderToStaticMarkup(createElement(ShowNonce))).toBe("<span>none</span>");
  });
});
