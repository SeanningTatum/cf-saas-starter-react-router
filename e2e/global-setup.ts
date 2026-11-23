import { execFileSync } from "node:child_process";
import { type APIRequestContext, type FullConfig, request } from "@playwright/test";
import { Effect, Schema } from "effect";
import { DEFAULT_SCENARIO, FIXTURE_ROLES } from "../app/lib/constants/fixtures";
import { FixtureLoginError, SeedError } from "../app/models/errors/fixture";
import { refuseRealAnalytics } from "../scripts/lib/analytics-guard";
import { postSignIn } from "./lib/auth-api";
import { type FixtureRole, storageStatePath } from "./lib/saved-session";
import {
  BANNED_REPLY,
  CLIENT_IPS,
  RESTORE_SEED_COMMAND,
  SEEDED_LOGINS,
  SEEDED_PASSWORD,
} from "./lib/values";

const SignInReply = Schema.parseJson(
  Schema.Struct({
    user: Schema.Struct({ email: Schema.String, role: Schema.NullishOr(Schema.String) }),
  }),
);

const loginError = (role: FixtureRole, status: number, reason: string) =>
  new FixtureLoginError({ role, status, message: `${role} fixture sign-in: ${reason}` });

const restoreSeed = Effect.try({
  try: () => {
    const [command, ...args] = RESTORE_SEED_COMMAND;
    execFileSync(command, args, { stdio: ["ignore", process.stderr, process.stderr] });
  },
  catch: (cause) =>
    new SeedError({
      scenario: DEFAULT_SCENARIO,
      target: "local",
      message: `${RESTORE_SEED_COMMAND.join(" ")} failed`,
      cause,
    }),
});

const checkReply = (role: FixtureRole, status: number, ok: boolean, body: string) => {
  if (role === "banned") {
    if (ok)
      return Effect.fail(loginError(role, status, "got a session, so the ban was not restored"));
    return BANNED_REPLY.test(body)
      ? Effect.void
      : Effect.fail(loginError(role, status, `refused for another reason: ${body}`));
  }
  if (!ok) return Effect.fail(loginError(role, status, body));
  return Schema.decodeUnknown(SignInReply)(body).pipe(
    Effect.mapError(() => loginError(role, status, "the reply holds no user")),
    Effect.filterOrFail(
      (reply) => reply.user.email === SEEDED_LOGINS[role] && reply.user.role === role,
      (reply) => loginError(role, status, `signed in as ${reply.user.role ?? "no role"}`),
    ),
  );
};

const signInAndSave = (api: APIRequestContext, role: FixtureRole, origin: string) =>
  Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: () =>
        postSignIn(
          api,
          { origin, clientIp: CLIENT_IPS["global-setup"] },
          { email: SEEDED_LOGINS[role], password: SEEDED_PASSWORD },
        ),
      catch: (cause) => loginError(role, 0, `the server did not answer: ${String(cause)}`),
    });
    const body = yield* Effect.tryPromise({
      try: () => res.text(),
      catch: () => loginError(role, res.status(), "the reply body could not be read"),
    });
    yield* checkReply(role, res.status(), res.ok(), body);
    const state = yield* Effect.tryPromise({
      try: () => api.storageState(),
      catch: () => loginError(role, res.status(), "the session could not be read back"),
    });
    if (role === "banned" && state.cookies.length > 0) {
      return yield* loginError(role, res.status(), "the refused sign-in still set a cookie");
    }
    yield* Effect.tryPromise({
      try: () => api.storageState({ path: storageStatePath(role) }),
      catch: () => loginError(role, res.status(), `${storageStatePath(role)} could not be written`),
    });
  });

const saveRole = (baseURL: string, role: FixtureRole) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => request.newContext({ baseURL }),
      catch: () => loginError(role, 0, "no request context"),
    }),
    (api) => signInAndSave(api, role, new URL(baseURL).origin),
    (api) => Effect.tryPromise(() => api.dispose()).pipe(Effect.ignore),
  );

const saveEveryRole = (config: FullConfig) =>
  Effect.gen(function* () {
    const baseURL = config.projects[0]?.use.baseURL;
    if (baseURL === undefined) {
      return yield* loginError("admin", 0, "playwright.config.ts sets no baseURL");
    }
    yield* Effect.forEach(FIXTURE_ROLES, (role) => saveRole(baseURL, role), { discard: true });
  });

const globalSetup = (config: FullConfig) =>
  Effect.runPromise(
    refuseRealAnalytics(process.cwd()).pipe(
      Effect.zipRight(restoreSeed),
      Effect.zipRight(saveEveryRole(config)),
    ),
  );

export default globalSetup;
