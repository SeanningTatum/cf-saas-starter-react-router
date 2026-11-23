import { expect, type Locator, type Page, type Response } from "@playwright/test";
import { TIMEOUTS_MS } from "./values";

const reactHasClaimedNode = (node: object) =>
  Object.keys(node).some((key) => key.startsWith("__reactProps$"));

export const expectHydrated = (ready: Locator, what: string) =>
  expect
    .poll(
      () =>
        ready
          .evaluate(reactHasClaimedNode, undefined, { timeout: TIMEOUTS_MS.oneLook })
          .catch(() => false),
      { timeout: TIMEOUTS_MS.hydration, message: `${what} never hydrated` },
    )
    .toBe(true);

const expectDocumentResponse: (
  response: Response | null,
  url: string,
) => asserts response is Response = (response, url) => {
  expect(response, `${url}: no document response`).not.toBeNull();
};

export const loadHydrated = async (
  page: Page,
  url: string,
  ready: (page: Page) => Locator,
): Promise<Response> => {
  const response = await page.goto(url);
  expectDocumentResponse(response, url);
  await expectHydrated(ready(page), url);
  return response;
};
