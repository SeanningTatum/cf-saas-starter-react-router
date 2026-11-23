import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestIdContext, useDocumentRequestId } from "../request-id";

const ShowId = () => createElement("span", null, useDocumentRequestId() ?? "none");

describe("useDocumentRequestId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the provided id on the server (catches a 404 page rendered with no id)", () => {
    const html = renderToStaticMarkup(
      createElement(RequestIdContext.Provider, { value: "req-1" }, createElement(ShowId)),
    );
    expect(html).toBe("<span>req-1</span>");
  });

  it("reads the id the server wrote on <html> in the browser (catches the id vanishing on hydration)", () => {
    vi.stubGlobal("document", { documentElement: { dataset: { requestId: "req-2" } } });
    expect(renderToStaticMarkup(createElement(ShowId))).toBe("<span>req-2</span>");
  });

  it("is undefined with no provider and no document (catches a made-up id)", () => {
    expect(renderToStaticMarkup(createElement(ShowId))).toBe("<span>none</span>");
  });
});
