import path from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";
import { postSignIn } from "./auth-api";
import { appOrigin, useClientIpPerFile } from "./client-ip";
import { SEEDED_LOGINS, SEEDED_PASSWORD, type SpecFile } from "./values";

const signInThroughApiSinceTheFormCanSubmitBeforeHydration = async (
  context: BrowserContext,
  origin: string,
  clientIp: string,
) => {
  const res = await postSignIn(
    context.request,
    { origin, clientIp },
    { email: SEEDED_LOGINS.admin, password: SEEDED_PASSWORD },
  );
  expect(res.ok(), `sign-in returned ${res.status()}: ${await res.text()}`).toBe(true);
};

const runInOneWorkerSoTheFileSignsInOnce = () => test.describe.configure({ mode: "default" });

export const useAdminSessionSignedInOncePerFile = (file: SpecFile) => {
  const storageState = path.join("test-results", ".auth", `${file}-admin.json`);
  runInOneWorkerSoTheFileSignsInOnce();
  const clientIp = useClientIpPerFile(file);
  test.use({ storageState });
  test.beforeAll(async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: undefined, baseURL });
    await signInThroughApiSinceTheFormCanSubmitBeforeHydration(
      context,
      appOrigin(baseURL),
      clientIp,
    );
    await context.storageState({ path: storageState });
    await context.close();
  });
  return clientIp;
};
