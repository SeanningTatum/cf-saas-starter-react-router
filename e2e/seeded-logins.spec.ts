import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";
import { Schema } from "effect";
import { storageStatePath, useSavedSession } from "./lib/saved-session";
import { API_PATHS, HTTP_STATUS, SEEDED_LOGINS } from "./lib/values";

const SessionReply = Schema.NullOr(
  Schema.Struct({ user: Schema.Struct({ email: Schema.String, role: Schema.String }) }),
);

const SavedState = Schema.parseJson(Schema.Struct({ cookies: Schema.Array(Schema.Unknown) }));

const sessionOf = async (context: BrowserContext) => {
  const res = await context.request.get(API_PATHS.getSession);
  expect(res.status()).toBe(HTTP_STATUS.ok);
  return Schema.decodeUnknownSync(SessionReply)(await res.json());
};

for (const role of ["admin", "user"] as const) {
  test.describe(`Saved ${role} session from global setup`, () => {
    useSavedSession(role, "seeded-logins");

    test(`the ${role} state holds a live session for the ${role} fixture with its fixture role, so specs that open it start signed in and the seed restored the role`, async ({
      context,
    }) => {
      const session = await sessionOf(context);
      expect(session?.user.email).toBe(SEEDED_LOGINS[role]);
      expect(session?.user.role).toBe(role);
    });
  });
}

test.describe("Saved banned session from global setup", () => {
  useSavedSession("banned", "seeded-logins");

  test("the banned state holds no cookie and no session, so the seed restored the ban and the refused sign-in left nothing behind", async ({
    context,
  }) => {
    const saved = Schema.decodeUnknownSync(SavedState)(
      readFileSync(storageStatePath("banned"), "utf8"),
    );
    expect(saved.cookies).toEqual([]);
    expect(await sessionOf(context)).toBeNull();
  });
});
