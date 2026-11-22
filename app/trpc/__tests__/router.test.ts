import { describe, expect, it, vi } from "vitest";
import { createCallerFactory, type Context } from "@/trpc";
import { appRouter } from "@/trpc/router";
import type { AppRuntime } from "@/runtime";

/**
 * The auth level of every procedure, declared in one place.
 *
 * `user.deleteUser` once sat behind `protectedProcedure`, so any signed-in
 * user could delete any non-admin account by id. Nothing caught it, because
 * no test asked "who may call this?". This table is that question, asked of
 * every procedure. A new procedure fails the first test until it is listed
 * here with its level, so the level is a choice a reviewer sees.
 *
 * `protected` means any signed-in user may call it. Give that level only to a
 * procedure that acts on the caller's own data; one that takes another user's
 * id belongs behind `admin`.
 */
type Level = "protected" | "admin";

const LEVELS: Record<string, Level> = {
  "user.getUsers": "protected",
  "user.createWorkflow": "protected",
  "admin.getUsers": "admin",
  "admin.getUser": "admin",
  "admin.updateUser": "admin",
  "admin.banUser": "admin",
  "admin.unbanUser": "admin",
  "admin.deleteUser": "admin",
  "admin.bulkBanUsers": "admin",
  "admin.bulkDeleteUsers": "admin",
  "admin.bulkUpdateUserRoles": "admin",
  "admin.dbHealth": "admin",
  "analytics.getUserGrowth": "admin",
  "analytics.getUserStats": "admin",
  "analytics.getRoleDistribution": "admin",
  "analytics.getVerificationDistribution": "admin",
  "analytics.getRecentSignupsCount": "admin",
};

// `import.meta.env.DEV` is always true under vitest, which makes
// `timingMiddleware` sleep 100-499ms of real time per call.
vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

// The auth middleware runs before input parsing and before the handler, so a
// refused call never reaches the runtime. A runtime that fails loudly proves it.
const runtime = new Proxy(
  {},
  {
    get: (_, key) => () =>
      Promise.reject(new Error(`runtime.${String(key)} reached by a refused call`)),
  }
) as unknown as AppRuntime;

const call = (role: "admin" | "user" | null, path: string) => {
  const caller = createCallerFactory(appRouter)({
    headers: new Headers(),
    runtime,
    auth:
      role === null ? null : { session: { id: "s1" }, user: { id: "u1", role } },
  } as unknown as Context);
  const procedure = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller);
  return (procedure as (input?: unknown) => Promise<unknown>)();
};

describe("procedure auth levels", () => {
  it("lists every procedure in the router, and nothing else", () => {
    // Catches: a procedure added without a declared level, and a removed
    // procedure (such as the old user.deleteUser) coming back unnoticed.
    expect(Object.keys(appRouter._def.procedures).sort()).toEqual(
      Object.keys(LEVELS).sort()
    );
  });

  it("has no user-level procedure that deletes users", () => {
    // Catches: the original hole. Deleting an account by id is admin-only
    // and lives at admin.deleteUser.
    expect(Object.keys(appRouter._def.procedures)).not.toContain("user.deleteUser");
  });

  it.each(Object.keys(LEVELS))("%s refuses an anonymous caller", async (path) => {
    // Catches: a procedure moved to publicProcedure.
    await expect(call(null, path)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each(Object.keys(LEVELS).filter((path) => LEVELS[path] === "admin"))(
    "%s refuses a signed-in non-admin",
    async (path) => {
      // Catches: an admin procedure moved to protectedProcedure, which hands
      // every signed-in user an admin action.
      await expect(call("user", path)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );
});
