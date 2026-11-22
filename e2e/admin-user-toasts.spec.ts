import { constants } from "node:http2";
import { test as base, expect, type Page } from "@playwright/test";
import { Schema } from "effect";
import adminText from "@/locales/en/admin.json" with { type: "json" };
import commonText from "@/locales/en/common.json" with { type: "json" };
import { useAdminSessionSignedInOncePerFile } from "./lib/admin-session";

type Member = { id: string; name: string; email: string };

const SignUpResponse = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });

const text = adminText.users_table;

const withName = (template: string, name: string) => template.replace(/\{\{-?\s*name\}\}/, () => name);

const test = base.extend<{ member: Member }>({
  member: async ({ browser, context, baseURL }, use) => {
    const runId = crypto.randomUUID();
    const member = { name: `Toast O'Neil & Co ${runId}`, email: `toast-${runId}@test.local` };
    const signUpContext = await browser.newContext({ storageState: undefined, baseURL });
    const res = await signUpContext.request.post("/api/auth/sign-up/email", {
      headers: { Origin: baseURL ?? "" },
      data: { ...member, password: crypto.randomUUID() },
    });
    expect(res.ok(), `sign-up returned ${res.status()}`).toBe(true);
    const { user } = Schema.decodeUnknownSync(SignUpResponse)(await res.json());
    await signUpContext.close();

    await use({ ...member, id: user.id });

    const removed = await context.request.post("/api/auth/admin/remove-user", {
      headers: { Origin: baseURL ?? "" },
      data: { userId: user.id },
    });
    expect(removed.ok(), `remove-user returned ${removed.status()}`).toBe(true);
  },
});

const toastRegion = (page: Page) =>
  page.getByRole("region", { name: `${commonText.notifications_region} alt+T`, exact: true });

const expectAnnounced = async (page: Page, message: string) => {
  const region = toastRegion(page);
  await expect(region).toHaveAttribute("aria-live", "polite");
  await expect(
    region.getByRole("listitem").filter({ has: page.getByText(message, { exact: true }) }),
  ).toBeVisible();
};

const memberRow = (page: Page, member: Member) => page.getByRole("row").filter({ hasText: member.email });

const openUsersTable = async (page: Page, member: Member) => {
  await page.goto(`/admin/users?${new URLSearchParams({ search: member.email })}`);
  await expect(memberRow(page, member)).toBeVisible();
};

const chooseRowActionDespiteCellRemount = async (page: Page, member: Member, action: string) => {
  const oneClickTimeout = 5_000;
  const trigger = memberRow(page, member).getByRole("button", { name: text.open_menu });
  const menu = page.getByRole("menu");
  await expect(async () => {
    await page.keyboard.press("Escape");
    await trigger.click({ timeout: oneClickTimeout });
    await menu.getByRole("menuitem", { name: action, exact: true }).click({ timeout: oneClickTimeout });
  }).toPass();
  await expect(menu).toBeHidden();
};

const bannedBadge = (page: Page, member: Member) =>
  memberRow(page, member).getByText(text.statuses.banned, { exact: true });

test.describe("Admin users table toasts", () => {
  useAdminSessionSignedInOncePerFile("admin-user-toasts");

  test(
    "ban and unban each announce their success toast with the name as plain text in the polite live region, which stays silent when no Toaster is mounted",
    { tag: "@golden" },
    async ({ page, member }) => {
      await openUsersTable(page, member);

      await chooseRowActionDespiteCellRemount(page, member, text.ban_user);
      await expectAnnounced(page, withName(text.toasts.ban_success, member.name));
      await expect(bannedBadge(page, member)).toBeVisible();

      await chooseRowActionDespiteCellRemount(page, member, text.unban_user);
      await expectAnnounced(page, withName(text.toasts.unban_success, member.name));
      await expect(memberRow(page, member)).toBeVisible();
      await expect(bannedBadge(page, member)).toHaveCount(0);
    },
  );

  test(
    "a ban the server refuses announces the ban error toast in the live region, never the success toast, and the user stays unbanned",
    { tag: "@error" },
    async ({ page, member }) => {
      await page.route("**/api/auth/admin/ban-user", (route) =>
        route.fulfill({
          status: constants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
          contentType: "application/json",
          body: JSON.stringify({ message: "Internal Server Error" }),
        }),
      );
      await openUsersTable(page, member);

      await chooseRowActionDespiteCellRemount(page, member, text.ban_user);

      await expectAnnounced(page, withName(text.toasts.ban_error, member.name));
      await expect(
        toastRegion(page).getByText(withName(text.toasts.ban_success, member.name), { exact: true }),
      ).toHaveCount(0);
      await expect(bannedBadge(page, member)).toHaveCount(0);
    },
  );
});
