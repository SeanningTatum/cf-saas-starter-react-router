import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

const reactHasClaimedNode = (node: object) => Object.keys(node).some((key) => key.startsWith("__reactProps$"));

export const hydrated = (ready: Locator, timeout: number): Promise<boolean> => {
  const oneLookTimeout = 1_000;
  return expect
    .poll(() => ready.evaluate(reactHasClaimedNode, undefined, { timeout: oneLookTimeout }).catch(() => false), {
      timeout,
      message: "the page never hydrated",
    })
    .toBe(true)
    .then(
      () => true,
      () => false,
    );
};

const extendTheTestTimeoutBy = (extra: number) => test.info().setTimeout(test.info().timeout + extra);

const expectDocumentResponse: (response: Response | null, url: string) => asserts response is Response = (
  response,
  url,
) => {
  expect(response, `${url}: no document response`).not.toBeNull();
};

export const loadHydratedReloadingWhileViteReoptimizesDeps = async (
  page: Page,
  url: string,
  ready: (page: Page) => Locator,
): Promise<Response> => {
  const coldNavigationAllowance = 15_000;
  const firstLoadWait = 15_000;
  const afterReloadWait = 30_000;
  const reloadsBeforeGivingUp = 2;
  extendTheTestTimeoutBy(coldNavigationAllowance + firstLoadWait);
  let response = await page.goto(url);
  let wait = firstLoadWait;
  for (let reloadsLeft = reloadsBeforeGivingUp; !(await hydrated(ready(page), wait)); reloadsLeft -= 1) {
    expect(reloadsLeft, `${url} never hydrated`).toBeGreaterThan(0);
    extendTheTestTimeoutBy(coldNavigationAllowance + afterReloadWait);
    response = await page.reload();
    wait = afterReloadWait;
  }
  expectDocumentResponse(response, url);
  return response;
};
