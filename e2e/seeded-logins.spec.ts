import { expect, test } from "@playwright/test";
import { postSignIn } from "./lib/auth-api";
import { appOrigin } from "./lib/client-ip";
import { CLIENT_IPS, HTTP_STATUS, SEEDED_LOGINS, SEEDED_PASSWORD } from "./lib/values";

const caller = (baseURL: string | undefined) => ({
  origin: appOrigin(baseURL),
  clientIp: CLIENT_IPS["seeded-logins"],
});

test.describe("Seeded logins restored by global setup", () => {
  test("admin and user sign in with the fixture password and get their fixture roles, so a fresh checkout needs no manual seed", {
    tag: "@golden",
  }, async ({ request, baseURL }) => {
    for (const [role, email] of [
      ["admin", SEEDED_LOGINS.admin],
      ["user", SEEDED_LOGINS.user],
    ] as const) {
      const res = await postSignIn(request, caller(baseURL), { email, password: SEEDED_PASSWORD });
      expect(res.status(), `${role} sign-in returned ${res.status()}: ${await res.text()}`).toBe(
        HTTP_STATUS.ok,
      );
      const body = (await res.json()) as { user?: { email?: string; role?: string } };
      expect(body.user?.email).toBe(email);
      expect(body.user?.role).toBe(role);
    }
  });

  test("the banned fixture is refused a session, so the seed restored its ban", {
    tag: "@error",
  }, async ({ request, baseURL }) => {
    const res = await postSignIn(request, caller(baseURL), {
      email: SEEDED_LOGINS.banned,
      password: SEEDED_PASSWORD,
    });
    expect(res.ok(), `banned sign-in returned ${res.status()}`).toBe(false);
    expect(await res.text()).toMatch(/banned/i);
  });
});
