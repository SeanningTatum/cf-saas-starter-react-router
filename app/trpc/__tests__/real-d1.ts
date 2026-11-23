import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppLoadContext } from "react-router";
import { getPlatformProxy } from "wrangler";
import { Effect } from "effect";
import { resolveAuthConfig } from "@/auth/config";
import { createAuth } from "@/auth/server";
import { makeAppRuntime } from "@/runtime";
import { createCallerFactory, createTRPCContext } from "@/trpc";
import { appRouter } from "@/trpc/router";

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

  const env = {
    ...proxy.env,
    BETTER_AUTH_SECRET: "real-d1-test-secret-0123456789abcdef0123456789",
    BETTER_AUTH_URL: BASE_URL,
  } as unknown as Env;

  const authOptions = { dev: false };
  const authConfig = Effect.runSync(resolveAuthConfig(env, authOptions));
  const auth = createAuth(env.DATABASE, authConfig);
  const runtime = makeAppRuntime(env, authOptions);
  const loadContext = { auth, runtime, cloudflare: { env } } as unknown as AppLoadContext;

  const signUp = async (email: string): Promise<Account> => {
    const res = await auth.api.signUpEmail({
      body: { name: email.split("@")[0] ?? email, email, password: PASSWORD },
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

  const contextFor = (headers: Headers) => createTRPCContext({ headers, runtime });
  const callerFor = async (headers: Headers) =>
    createCallerFactory(appRouter)(await contextFor(headers));

  const signUpAdmin = async (email: string): Promise<Account> => {
    const account = await signUp(email);
    await db.prepare("UPDATE user SET role = 'admin' WHERE id = ?").bind(account.userId).run();
    return { ...account, headers: await signIn(email) };
  };

  const dispose = async () => {
    await runtime.dispose();
    await proxy.dispose();
  };

  return {
    db,
    env,
    auth,
    authConfig,
    runtime,
    loadContext,
    signUp,
    signIn,
    contextFor,
    callerFor,
    signUpAdmin,
    dispose,
  };
};

export type RealApp = Awaited<ReturnType<typeof startRealApp>>;
export type AppCaller = Awaited<ReturnType<RealApp["callerFor"]>>;
