import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { PROTECTED_USER_MESSAGE } from "@/lib/constants/admin";
import { APP_ERROR_TAGS } from "@/lib/constants/errors";
import { appRouter } from "@/trpc/router";
import { type AppCaller, startSeededApp } from "./seeded-caller";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const PLAIN = "seed-user";
const FIRST = "seed-user-001";
const GHOST = "ghost-user";
const DRIVER_TEXT = "RAISED_BY_TEST_TRIGGER";
const WINDOW = { startDate: new Date(0), endDate: new Date(1) };

const breakUserTable = (app: ReturnType<typeof startSeededApp>) =>
  app.exec(sql`alter table user rename to user_gone`);

const refuseWrites = (app: ReturnType<typeof startSeededApp>, event: "update" | "delete") =>
  app.exec(
    sql.raw(
      `create trigger refuse before ${event} on user begin select raise(abort, '${DRIVER_TEXT}'); end`,
    ),
  );

type Call = (caller: AppCaller) => Promise<unknown>;

const READS_THROUGH_USER_TABLE: ReadonlyArray<readonly [string, Call, string]> = [
  ["admin.getUsers", (c) => c.admin.getUsers({ page: 0, limit: 10 }), "Failed to query user"],
  ["admin.getUser", (c) => c.admin.getUser({ userId: PLAIN }), "Failed to query user"],
  [
    "admin.updateUser",
    (c) => c.admin.updateUser({ userId: PLAIN, data: { name: "x" } }),
    "Failed to query user",
  ],
  ["admin.banUser", (c) => c.admin.banUser({ userId: PLAIN }), "Failed to query user"],
  ["admin.unbanUser", (c) => c.admin.unbanUser({ userId: PLAIN }), "Failed to query user"],
  ["admin.deleteUser", (c) => c.admin.deleteUser({ userId: PLAIN }), "Failed to query user"],
  ["admin.bulkBanUsers", (c) => c.admin.bulkBanUsers({ userIds: [FIRST] }), "Failed to query user"],
  [
    "admin.bulkDeleteUsers",
    (c) => c.admin.bulkDeleteUsers({ userIds: [FIRST] }),
    "Failed to query user",
  ],
  [
    "admin.bulkUpdateUserRoles",
    (c) => c.admin.bulkUpdateUserRoles({ userIds: [FIRST], role: "admin" }),
    "Failed to query user",
  ],
  [
    "analytics.getUserGrowth",
    (c) => c.analytics.getUserGrowth(WINDOW),
    "Failed to query user_growth",
  ],
  ["analytics.getUserStats", (c) => c.analytics.getUserStats(), "Failed to query user_stats"],
  [
    "analytics.getRoleDistribution",
    (c) => c.analytics.getRoleDistribution(),
    "Failed to query role_distribution",
  ],
  [
    "analytics.getVerificationDistribution",
    (c) => c.analytics.getVerificationDistribution(),
    "Failed to query verification_distribution",
  ],
  [
    "analytics.getRecentSignupsCount",
    (c) => c.analytics.getRecentSignupsCount({ days: 7 }),
    "Failed to query recent_signups",
  ],
];

describe("a failing database reaches the client as a generic 500 from every procedure that reads the user table", () => {
  it.each(READS_THROUGH_USER_TABLE)(
    "%s fails with INTERNAL_SERVER_ERROR and the QueryError message, so a driver failure is not a defect with no tag and the client sees no SQL",
    async (_path, call, message) => {
      const app = startSeededApp(appRouter, "many-users");
      await breakUserTable(app);
      const failure = await call(app.callerAs()).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message });
    },
  );
});

describe("each tagged error a procedure can raise arrives with the status tagToTRPC names", () => {
  it("NotFoundError from admin.getUser is NOT_FOUND", async () => {
    const app = startSeededApp(appRouter, "many-users");
    await expect(app.callerAs().admin.getUser({ userId: GHOST })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("ValidationError from admin.deleteUser on an admin is BAD_REQUEST with the protected-user message", async () => {
    const app = startSeededApp(appRouter, "many-users");
    await expect(app.callerAs().admin.deleteUser({ userId: "seed-admin" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: PROTECTED_USER_MESSAGE,
    });
  });

  const WRITES: ReadonlyArray<readonly [string, "update" | "delete", Call, string]> = [
    [
      "admin.updateUser",
      "update",
      (c) => c.admin.updateUser({ userId: PLAIN, data: { name: "x" } }),
      "Failed to update user",
    ],
    ["admin.banUser", "update", (c) => c.admin.banUser({ userId: PLAIN }), "Failed to update user"],
    [
      "admin.unbanUser",
      "update",
      (c) => c.admin.unbanUser({ userId: "seed-banned" }),
      "Failed to update user",
    ],
    [
      "admin.bulkBanUsers",
      "update",
      (c) => c.admin.bulkBanUsers({ userIds: [FIRST] }),
      "Failed to update user",
    ],
    [
      "admin.bulkUpdateUserRoles",
      "update",
      (c) => c.admin.bulkUpdateUserRoles({ userIds: [FIRST], role: "admin" }),
      "Failed to update user",
    ],
    [
      "admin.deleteUser",
      "delete",
      (c) => c.admin.deleteUser({ userId: PLAIN }),
      "Failed to delete user",
    ],
    [
      "admin.bulkDeleteUsers",
      "delete",
      (c) => c.admin.bulkDeleteUsers({ userIds: [FIRST] }),
      "Failed to delete user",
    ],
  ];

  it.each(WRITES)(
    "%s with a write the database refuses is INTERNAL_SERVER_ERROR (UpdateError or DeletionError) and the driver's text stays out of the message",
    async (_path, event, call, message) => {
      const app = startSeededApp(appRouter, "many-users");
      await refuseWrites(app, event);
      const failure = await call(app.callerAs()).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message });
      expect(String((failure as Error).message)).not.toContain(DRIVER_TEXT);
    },
  );
});

const REACHED_BY_A_PROCEDURE = [
  "NotFoundError",
  "ValidationError",
  "QueryError",
  "UpdateError",
  "DeletionError",
] as const;

const NO_PROCEDURE_RAISES_IT: Readonly<Record<string, string>> = {
  CreationError: "no procedure inserts a row; sign-up runs through Better Auth",
  ConfigurationError: "raised only by services that read bindings, none of them under a procedure",
  ExternalServiceError: "no procedure calls an outside service",
  BucketBindingError:
    "only the upload routes and the delete purge reach the bucket; no test makes R2 fail",
  BucketUploadError:
    "only the upload routes and the delete purge reach the bucket; no test makes R2 fail",
  BucketGetError:
    "only the upload routes and the delete purge reach the bucket; no test makes R2 fail",
  BucketNotFoundError:
    "only the upload routes and the delete purge reach the bucket; no test makes R2 fail",
  BucketDeleteError:
    "only the upload routes and the delete purge reach the bucket; no test makes R2 fail",
  BucketListError:
    "only the upload routes and the delete purge reach the bucket; no test makes R2 fail",
  BucketValidationError:
    "only the upload routes and the delete purge reach the bucket; no test makes R2 fail",
  UploadQuotaError: "raised by the upload route, which answers 413; no procedure stores a file",
  AnalyticsDeliveryError: "Analytics.capture cannot fail; a delivery failure is logged at dispose",
  RateLimitError: "limits sit on Better Auth routes, covered by rate-limit.test.ts",
  FixtureValidationError: "raised by the seed scripts, never under a request",
  SeedError: "raised by the seed scripts, never under a request",
  DevServerRunningError: "raised by the seed scripts, never under a request",
  FixtureLoginError: "raised by Playwright global setup, never under a request",
  RealAnalyticsProviderError: "raised by Playwright global setup, never under a request",
  SandboxDisabledError:
    "raised by the sandbox route loaders, which fold it into a 404; no procedure",
  SandboxUnknownModuleError: "raised by the sandbox page loader, which folds it into a 404",
  SandboxUnknownScenarioError: "raised by the sandbox page loader, which folds it into a 404",
  SandboxCaseNotDeclaredError: "raised by the sandbox page loader, which folds it into a 404",
};

describe("every tagged error is accounted for", () => {
  it("is either raised by a tested procedure above or listed with the reason none can raise it, so a new tag cannot join the app unclassified", () => {
    const accounted = [...REACHED_BY_A_PROCEDURE, ...Object.keys(NO_PROCEDURE_RAISES_IT)].sort();
    expect(accounted).toEqual([...APP_ERROR_TAGS].sort());
  });
});
