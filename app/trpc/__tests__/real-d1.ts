import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppLoadContext } from "react-router";
import { getPlatformProxy } from "wrangler";
import { createAuth } from "@/auth/server";
import { makeAppRuntime } from "@/runtime";
import { createCallerFactory, createTRPCContext } from "@/trpc";
import { appRouter } from "@/trpc/router";

/**
 * The whole app on real local D1, for tests whose claim only a real database
 * can prove: a live session dying, a WHERE clause refusing another user's row,
 * a statement staying under D1's bound-variable limit.
 *
 * Why these tests break the "no D1" rule, on purpose: a stub returns what the
 * test told it to, so it cannot show what SQLite does with the query. This runs
 * real local D1 (wrangler's platform proxy, in memory, a fresh database per
 * call), the migrations in `drizzle/`, real Better Auth and the real tRPC
 * router; nothing under test is mocked.
 *
 * Each test file must still mock `@/lib/log-format` itself (vi.mock is hoisted
 * per file): `import.meta.env.DEV` is always true under vitest, which makes
 * `timingMiddleware` sleep 100-499ms of real time per call.
 */

const PASSWORD = "correct-horse-battery-staple";
export const BASE_URL = "http://localhost";
const MIGRATIONS = fileURLToPath(new URL("../../../drizzle/", import.meta.url));

export type Account = { userId: string; email: string; headers: Headers };

const headersFrom = (setCookie: Headers): Headers =>
  new Headers({
    cookie: setCookie
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });

export const startRealApp = async () => {
  const proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  const db = proxy.env.DATABASE;

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const statements = readFileSync(`${MIGRATIONS}${file}`, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) await db.prepare(statement).run();
  }

  // The proxy has no workflow binding and no secret; `user.createWorkflow`
  // needs the first, Better Auth the second.
  const env = {
    ...proxy.env,
    BETTER_AUTH_SECRET: "real-d1-test-secret-0123456789abcdef0123456789",
    EXAMPLE_WORKFLOW: { create: async () => ({ id: "wf-test" }) },
  } as unknown as Env;

  const auth = createAuth(env.DATABASE, env.BETTER_AUTH_SECRET, BASE_URL);
  const runtime = makeAppRuntime(env, BASE_URL);
  const loadContext = { auth } as unknown as AppLoadContext;

  const signUp = async (email: string): Promise<Account> => {
    const res = await auth.api.signUpEmail({
      body: { name: email.split("@")[0], email, password: PASSWORD },
      returnHeaders: true,
    });
    return { userId: res.response.user.id, email, headers: headersFrom(res.headers) };
  };

  const signIn = async (email: string): Promise<Headers> => {
    const res = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    return headersFrom(res.headers);
  };

  // A fresh context per call: the session is resolved when the context is
  // built, so reusing one would hide a session that died after it was built.
  const callerFor = async (headers: Headers) =>
    createCallerFactory(appRouter)(await createTRPCContext({ headers, runtime }));

  /** Signs up, makes the user an admin, then signs in again so the session carries the role. */
  const signUpAdmin = async (email: string): Promise<Account> => {
    const account = await signUp(email);
    await db.prepare("UPDATE user SET role = 'admin' WHERE id = ?").bind(account.userId).run();
    return { ...account, headers: await signIn(email) };
  };

  const dispose = async () => {
    await runtime.dispose();
    await proxy.dispose();
  };

  return { db, auth, loadContext, signUp, signIn, callerFor, signUpAdmin, dispose };
};

export type RealApp = Awaited<ReturnType<typeof startRealApp>>;
export type AppCaller = Awaited<ReturnType<RealApp["callerFor"]>>;
