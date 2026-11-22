import { describe, expect, it } from "vitest";
import { resolveLogin } from "../audit-login";

const seeded = {
  admin: { email: "admin@x.test", password: "pw-admin" },
  user: { email: "user@x.test", password: "pw-user" },
};

describe("resolveLogin", () => {
  it("returns the seeded login for a bare name: a name must not be read as an email", () => {
    expect(resolveLogin("admin", seeded)).toEqual(seeded.admin);
  });

  it("splits email:password at the first colon only: a password with a colon must survive", () => {
    expect(resolveLogin("me@x.test:pa:ss", seeded)).toEqual({ email: "me@x.test", password: "pa:ss" });
  });

  it("refuses a leading colon with the usage line: an empty email would sign in as nobody", () => {
    expect(resolveLogin(":pw", seeded)).toEqual({ error: "--login expects <name> or <email:password>" });
  });

  it("lists the seeded names for an unknown name, and says none are set when the map is empty", () => {
    expect(resolveLogin("root", seeded)).toEqual({ error: 'unknown login "root"; seeded logins: admin, user' });
    expect(resolveLogin("root", {})).toEqual({ error: 'unknown login "root"; seeded logins: none are set in harness.config.json' });
  });

  it("does not walk the prototype chain: 'constructor' is not a seeded login", () => {
    expect(resolveLogin("constructor", seeded)).toMatchObject({ error: expect.stringContaining("unknown login") });
  });
});
