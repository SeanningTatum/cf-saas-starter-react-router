import { describe, expect, it } from "vitest";
import {
  BASE_USERS,
  FIXTURE_ROLE_EMAILS,
  FIXTURE_ROLES,
  SEED_EMAIL_DOMAIN,
  SEED_EMAIL_PATTERN,
  SEED_ID_LIKE,
  SEED_ID_PREFIX,
} from "../fixtures";

describe("fixture constants", () => {
  it("gives each fixture role exactly one base user, whose email is that role's login email, so the harness signs in as the right account", () => {
    expect(BASE_USERS.map((user) => user.fixtureRole).sort()).toEqual([...FIXTURE_ROLES].sort());
    for (const user of BASE_USERS) {
      expect(user.email).toBe(FIXTURE_ROLE_EMAILS[user.fixtureRole]);
    }
  });

  it("keeps the LIKE pattern on the seed id prefix, so a renamed prefix cannot leave a restore deleting nothing", () => {
    expect(SEED_ID_LIKE).toBe(`${SEED_ID_PREFIX}%`);
    for (const user of BASE_USERS) expect(user.id.startsWith(SEED_ID_PREFIX)).toBe(true);
  });

  it("keeps every role email on the seed domain and inside the email pattern, so no fixture can take a real address", () => {
    for (const email of Object.values(FIXTURE_ROLE_EMAILS)) {
      expect(email.endsWith(`@${SEED_EMAIL_DOMAIN}`)).toBe(true);
      expect(SEED_EMAIL_PATTERN.test(email)).toBe(true);
    }
    expect(SEED_EMAIL_PATTERN.test(`admin@${SEED_EMAIL_DOMAIN}.example.com`)).toBe(false);
  });
});
