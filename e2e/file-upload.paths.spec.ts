import { test, expect, type BrowserContext, type Route } from "@playwright/test";
import path from "node:path";
import { Either } from "effect";
import { describePath, fileUploadEdgePaths, type ModelEvent } from "@/components/file-upload.model";

/**
 * FileUpload, one test per machine transition, generated from
 * app/components/file-upload.machine.ts with xstate/graph.
 *
 * Each test replays the shortest path to a state plus one more event on
 * /admin/kitchen-sink#upload and checks `data-state` after every step. The
 * upload request is held open by a route mock and released when the path
 * reaches the upload actor's done event, so `uploading` is observable and the
 * reply (ok or refused) comes from the model. The real upload to R2 is walked
 * by feature-verifier, not here.
 *
 * Catches: a state the UI cannot reach, a transition the UI does not make
 * (e.g. "Upload another" leaving the success panel up), and drift between the
 * machine and the markup.
 */

const MAX = 1024 * 1024; // must match <FileUpload maxSize> on the kitchen-sink page
const small = new File(["hello"], "small.txt", { type: "text/plain" });
const big = new File([new Uint8Array(MAX + 1)], "big.bin", { type: "application/octet-stream" });

const paths = fileUploadEdgePaths({ maxSize: MAX, small, big });

const AUTH = path.join("test-results", ".auth", "file-upload-admin.json");

// Sign in through the Better Auth API, not the form: on a cold dev server the
// form can be submitted before hydration and the login silently fails.
const login = async (context: BrowserContext, baseURL: string) => {
  const res = await context.request.post("/api/auth/sign-in/email", {
    headers: { Origin: baseURL },
    data: { email: "admin@preview.local", password: "Password123!" },
  });
  expect(res.ok(), `sign-in returned ${res.status()}`).toBe(true);
};

test.describe("FileUpload paths", () => {
  // One login for the file, in one worker: a login per test trips Better
  // Auth's sign-in rate limit.
  test.describe.configure({ mode: "default" });
  test.use({ storageState: AUTH });
  test.beforeAll(async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: undefined, baseURL });
    await login(context, baseURL ?? "");
    await context.storageState({ path: AUTH });
    await context.close();
  });

  for (const statePath of paths) {
    const end = String(statePath.state.value);
    const name = describePath(statePath.steps as ReadonlyArray<{ event: ModelEvent }>, end);
    // The smoke videos record one golden and one error path.
    const tag =
      name === "PICK small.txt → upload ok → success"
        ? "@golden"
        : name === "PICK small.txt → upload refused → failed"
          ? "@error"
          : undefined;

    test(name, tag ? { tag } : {}, async ({ page }) => {
      // Uploads wait here until the path's done event says how to answer.
      const held: Route[] = [];
      await page.route("**/api/upload-file", (route) => {
        held.push(route);
      });

      await page.goto("/admin/kitchen-sink#upload");
      const root = page.getByTestId("file-upload");
      const dropzone = page.getByTestId("file-upload-dropzone");
      await expect(root).toHaveAttribute("data-state", "idle");

      // The server renders data-state="idle" too, so "loaded" does not mean
      // React has hydrated, and networkidle can hang on the dev server. On a
      // cold dev server the first load can also die on Vite's "Outdated
      // Optimize Dep" 504s. Prove the machine is live with a drag in and out,
      // reloading until a handler answers.
      await expect(async () => {
        await dropzone.dispatchEvent("dragover");
        if ((await root.getAttribute("data-state")) !== "dragging") {
          await page.reload();
          throw new Error("FileUpload has not hydrated yet");
        }
      }).toPass({ timeout: 60_000 });
      await dropzone.dispatchEvent("dragleave");
      await expect(root).toHaveAttribute("data-state", "idle");

      for (const step of statePath.steps) {
        const event = step.event as ModelEvent | { type: "xstate.init" };
        switch (event.type) {
          case "xstate.init":
            break;
          case "DRAG_ENTER":
            await dropzone.dispatchEvent("dragover");
            break;
          case "DRAG_LEAVE":
            await dropzone.dispatchEvent("dragleave");
            break;
          case "PICK":
            await page.getByTestId("file-upload-input").setInputFiles({
              name: event.file.name,
              mimeType: event.file.type,
              buffer: Buffer.from(await event.file.arrayBuffer()),
            });
            break;
          case "RESET":
            await page.getByTestId("file-upload-reset").click();
            break;
          case "xstate.done.actor.upload": {
            await expect.poll(() => held.length).toBe(1);
            const route = held.shift() as Route;
            await Either.match(event.output, {
              onRight: ({ key }) => route.fulfill({ json: { success: true, key } }),
              onLeft: (e) =>
                route.fulfill({
                  status: 400,
                  json: { success: false, error: "message" in e ? e.message : "error" },
                }),
            });
            break;
          }
        }
        await expect(root).toHaveAttribute("data-state", String(step.state.value));
      }

      // What each end state must show, beyond its data-state.
      const { context } = statePath.state;
      if (end === "success") {
        await expect(page.getByTestId("file-upload-key")).toContainText(context.key ?? "");
      }
      if (end === "failed") {
        await expect(page.getByTestId("file-upload-error")).toBeVisible();
      } else {
        await expect(page.getByTestId("file-upload-error")).toHaveCount(0);
      }
      if (end === "idle" || end === "dragging") {
        await expect(dropzone).toBeVisible();
      }
    });
  }
});
