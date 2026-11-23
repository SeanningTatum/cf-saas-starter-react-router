import { expect, test, type Locator, type Page } from "@playwright/test";
import { BROWSER_REPORT_PATH } from "../app/lib/constants/error-reporting";
import { useSavedSession } from "./lib/saved-session";
import { useClientIpPerFile } from "./lib/client-ip";
import { loadHydrated } from "./lib/hydration";
import { HTTP_STATUS, PAGE_PATHS } from "./lib/values";

const DOC = "docs/security-headers.md";
const HYDRATION_TEXT = /hydrat/i;
const CONSOLE_PROBLEM_TYPES = new Set(["error", "warning"]);
const RECOVERABLE_SOURCE = "recoverable";

type Problem = { kind: "console" | "report"; text: string };

const watchers = new WeakMap<Page, Problem[]>();

const watchHydrationProblems = (page: Page): Problem[] => {
  const watched = watchers.get(page);
  if (watched) return watched;
  const problems: Problem[] = [];
  watchers.set(page, problems);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) problems.length = 0;
  });
  page.on("console", (msg) => {
    if (CONSOLE_PROBLEM_TYPES.has(msg.type()) && HYDRATION_TEXT.test(msg.text())) {
      problems.push({ kind: "console", text: msg.text() });
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== BROWSER_REPORT_PATH) return;
    const body = request.postData() ?? "";
    if (body.includes(`"source":"${RECOVERABLE_SOURCE}"`)) {
      problems.push({ kind: "report", text: body });
    }
  });
  return problems;
};

const letReactFinishLogging = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      }),
  );

const expectNoHydrationProblem = async (
  page: Page,
  url: string,
  ready: (page: Page) => Locator,
) => {
  const problems = watchHydrationProblems(page);
  await loadHydrated(page, url, ready);
  expect(new URL(page.url()).pathname, `${url} redirected; is the fixture signed in?`).toBe(url);
  await letReactFinishLogging(page);
  expect(
    problems,
    `${url}: the server HTML and the browser's first render differ. A tag must get the same attributes on both sides; a nonce goes only on scripts (see ${DOC})`,
  ).toEqual([]);
};

test.describe("Hydration, signed out (issue #166: the server and the browser render the same HTML, so a real mismatch is not lost in noise)", () => {
  useClientIpPerFile("hydration");

  test("home, login and sign-up hydrate with no warning, so a nonce on the <Links /> tags, which the browser hides, cannot come back", {
    tag: "@golden",
  }, async ({ page }) => {
    await expectNoHydrationProblem(page, PAGE_PATHS.home, (p) => p.getByTestId("topbar-sign-in"));
    await expectNoHydrationProblem(page, PAGE_PATHS.login, (p) => p.getByTestId("login-submit"));
    await expectNoHydrationProblem(page, PAGE_PATHS.signUp, (p) => p.getByTestId("signup-submit"));
  });
});

test.describe("Hydration, signed in as admin", () => {
  useSavedSession("admin", "hydration");

  test("dashboard and admin hydrate with no warning, so the signed-in layouts render the same HTML on the server and in the browser", async ({
    page,
  }) => {
    await expectNoHydrationProblem(page, PAGE_PATHS.dashboard, (p) =>
      p.getByTestId("dashboard-go-admin"),
    );
    await expectNoHydrationProblem(page, PAGE_PATHS.admin, (p) =>
      p.getByRole("button", { name: "Toggle Sidebar" }).first(),
    );
  });
});

test.describe("Cold load of the kitchen sink, signed in as admin (issue #50)", () => {
  useSavedSession("admin", "hydration");

  test("the first load of /admin/kitchen-sink gets no 504 from Vite's dependency optimizer, so it hydrates without a reload (on a cold cache, `rm -rf node_modules/.vite`, a late-found dependency would fail here)", async ({
    page,
  }) => {
    const gatewayTimeouts: string[] = [];
    page.on("response", (response) => {
      if (response.status() === HTTP_STATUS.gatewayTimeout) gatewayTimeouts.push(response.url());
    });
    await loadHydrated(page, PAGE_PATHS.adminKitchenSink, (p) =>
      p.getByTestId("file-upload-dropzone"),
    );
    expect(gatewayTimeouts, "Vite re-optimized dependencies during the first load").toEqual([]);
  });
});
