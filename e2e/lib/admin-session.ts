import path from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";

const signInThroughApiSinceTheFormCanSubmitBeforeHydration = async (context: BrowserContext, origin: string) => {
  const res = await context.request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email: "admin@preview.local", password: "Password123!" },
  });
  expect(res.ok(), `sign-in returned ${res.status()}`).toBe(true);
};

const runInOneWorkerSoSignInsStayUnderTheRateLimit = () => test.describe.configure({ mode: "default" });

export const useAdminSessionSignedInOncePerFile = (name: string) => {
  const storageState = path.join("test-results", ".auth", `${name}-admin.json`);
  runInOneWorkerSoSignInsStayUnderTheRateLimit();
  test.use({ storageState });
  test.beforeAll(async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: undefined, baseURL });
    await signInThroughApiSinceTheFormCanSubmitBeforeHydration(context, baseURL ?? "");
    await context.storageState({ path: storageState });
    await context.close();
  });
};
