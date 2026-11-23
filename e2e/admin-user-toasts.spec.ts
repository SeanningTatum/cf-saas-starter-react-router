import { constants } from "node:http2";
import { test as base, expect, type Page } from "@playwright/test";
import { Schema } from "effect";
import adminText from "@/locales/en/admin.json" with { type: "json" };
import commonText from "@/locales/en/common.json" with { type: "json" };
import { useSavedSession } from "./lib/saved-session";
import { postAppApi, postSignUp } from "./lib/auth-api";
import { appOrigin } from "./lib/client-ip";
import { API_PATHS, CLIENT_IPS, PAGE_PATHS } from "./lib/values";
import { loadHydrated } from "./lib/hydration";

type Member = { id: string; name: string; email: string };

const SignUpResponse = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });

const text = adminText.users_table;

const withName = (template: string, name: string) =>
  template.replace(/\{\{-?\s*name\}\}/, () => name);

const test = base.extend<{ member: Member }>({
  member: async ({ browser, context, baseURL }, use) => {
    const runId = crypto.randomUUID();
    const member = { name: `Toast O'Neil & Co ${runId}`, email: `toast-${runId}@test.local` };
    const caller = { origin: appOrigin(baseURL), clientIp: CLIENT_IPS["admin-user-toasts"] };
    const signUpContext = await browser.newContext({ storageState: undefined, baseURL });
    const res = await postSignUp(signUpContext.request, caller, {
      ...member,
      password: crypto.randomUUID(),
    });
    expect(res.ok(), `sign-up returned ${res.status()}: ${await res.text()}`).toBe(true);
    const { user } = Schema.decodeUnknownSync(SignUpResponse)(await res.json());
    await signUpContext.close();

    await use({ ...member, id: user.id });

    const removed = await postAppApi(context.request, caller, API_PATHS.removeUser, {
      userId: user.id,
    });
    expect(removed.ok(), `remove-user returned ${removed.status()}`).toBe(true);
  },
});

const toastRegion = (page: Page) =>
  page.getByRole("region", { name: `${commonText.notifications_region} alt+T`, exact: true });

const announcedToast = (page: Page, message: string) =>
  toastRegion(page)
    .getByRole("listitem")
    .filter({ has: page.getByText(message, { exact: true }) });

const expectAnnounced = async (page: Page, message: string) => {
  await expect(toastRegion(page)).toHaveAttribute("aria-live", "polite");
  await expect(announcedToast(page, message)).toBeVisible();
};

const memberRow = (page: Page, member: Member) =>
  page.getByRole("row").filter({ hasText: member.email });

const rowMenuTrigger = (page: Page, member: Member) =>
  memberRow(page, member).getByRole("button", { name: text.open_menu });

const openUsersTable = async (page: Page, member: Member) => {
  await loadHydrated(page, `/admin/users?${new URLSearchParams({ search: member.email })}`, (p) =>
    rowMenuTrigger(p, member),
  );
  await expect(memberRow(page, member)).toBeVisible();
};

const chooseRowAction = async (page: Page, member: Member, action: string) => {
  const menu = page.getByRole("menu");
  await rowMenuTrigger(page, member).click();
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
  await expect(menu).toBeHidden();
};

const bannedBadge = (page: Page, member: Member) =>
  memberRow(page, member).getByText(text.statuses.banned, { exact: true });

test.describe("Admin users table toasts", () => {
  useSavedSession("admin", "admin-user-toasts");

  test("ban and unban each announce their success toast with the name as plain text in the polite live region, which stays silent when no Toaster is mounted", {
    tag: "@golden",
  }, async ({ page, member }) => {
    await openUsersTable(page, member);

    await chooseRowAction(page, member, text.ban_user);
    await expectAnnounced(page, withName(text.toasts.ban_success, member.name));
    await expect(bannedBadge(page, member)).toBeVisible();

    await chooseRowAction(page, member, text.unban_user);
    await expectAnnounced(page, withName(text.toasts.unban_success, member.name));
    await expect(memberRow(page, member)).toBeVisible();
    await expect(bannedBadge(page, member)).toHaveCount(0);
  });

  test("a ban the server refuses announces the ban error toast in the live region, never the success toast, the user stays unbanned, and the error closes from its own close button", {
    tag: "@error",
  }, async ({ page, member }) => {
    await page.route("**/api/auth/admin/ban-user", (route) =>
      route.fulfill({
        status: constants.HTTP_STATUS_INTERNAL_SERVER_ERROR,
        contentType: "application/json",
        body: JSON.stringify({ message: "Internal Server Error" }),
      }),
    );
    await openUsersTable(page, member);

    await chooseRowAction(page, member, text.ban_user);

    const banError = withName(text.toasts.ban_error, member.name);
    await expectAnnounced(page, banError);
    await announcedToast(page, banError)
      .getByRole("button", { name: commonText.close_notification, exact: true })
      .click();
    await expect(announcedToast(page, banError)).toHaveCount(0);
    await expect(
      toastRegion(page).getByText(withName(text.toasts.ban_success, member.name), { exact: true }),
    ).toHaveCount(0);
    await expect(bannedBadge(page, member)).toHaveCount(0);
  });

  test("selecting a row with the keyboard keeps focus on its checkbox, since a re-render no longer remounts the table's cells", async ({
    page,
    member,
  }) => {
    await openUsersTable(page, member);
    const select = memberRow(page, member).getByRole("checkbox", { name: text.select_row });
    await select.focus();
    await page.keyboard.press("Space");
    await expect(select).toBeChecked();
    await expect(select).toBeFocused();
  });

  test("impersonating a user opens their dashboard and announces the impersonation toast after the full page load", async ({
    page,
    member,
    baseURL,
  }) => {
    await openUsersTable(page, member);
    await chooseRowAction(page, member, text.impersonate);

    await page.waitForURL(PAGE_PATHS.dashboard);
    await expectAnnounced(page, withName(text.toasts.impersonate_success, member.name));

    const caller = { origin: appOrigin(baseURL), clientIp: CLIENT_IPS["admin-user-toasts"] };
    const stopped = await postAppApi(page.request, caller, API_PATHS.stopImpersonating, {});
    expect(stopped.ok(), `stop-impersonating returned ${stopped.status()}`).toBe(true);
  });
});
