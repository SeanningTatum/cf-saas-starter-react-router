import { expect, test } from "@playwright/test";

const HEALTHZ = "/healthz";
const RELEASE_SHAPE = /^[A-Za-z0-9._+-]{1,64}$/;

test.describe("Health route (issue #94): up or down and the release, nothing more", () => {
  test("GET /healthz answers 200 with status up, a release and no-store, so that a deploy's smoke check reads the live build and no cache answers for it", {
    tag: ["@golden", "@deployed"],
  }, async ({ request }) => {
    const response = await request.get(HEALTHZ);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(
      response.headers()["x-request-id"],
      "the route skipped the Worker's request id",
    ).toBeTruthy();

    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["release", "status"]);
    expect(body.status).toBe("up");
    expect(body.release).toMatch(RELEASE_SHAPE);
    const expected = process.env.E2E_EXPECT_RELEASE;
    if (expected) expect(body.release, "another release answered").toBe(expected);
  });

  test("a POST to /healthz is refused and its answer holds no health fields or stack, so that the route reads only and a wrong method leaks nothing", {
    tag: ["@error", "@deployed"],
  }, async ({ request }) => {
    const response = await request.post(HEALTHZ, { data: {} });
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe("GET, HEAD");
    expect(await response.text()).toBe("");
  });
});
