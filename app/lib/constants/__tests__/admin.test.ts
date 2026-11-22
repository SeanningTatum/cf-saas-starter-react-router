import { describe, expect, it } from "vitest";
import { admin } from "better-auth/plugins";
import { Option, Schema } from "effect";
import {
  ADMIN_PATHS_REVIEWED_AS_OPEN,
  ADMIN_PATHS_TARGETING_SESSION_TOKEN,
  ADMIN_PATHS_TARGETING_USER_ID,
} from "../admin";

const ObjectBody = Schema.Struct({
  body: Schema.Struct({ shape: Schema.Record({ key: Schema.String, value: Schema.Unknown }) }),
});

const endpoints = Object.values(admin().endpoints).map((endpoint) => ({
  path: endpoint.path,
  bodyKeys: Option.match(Schema.decodeUnknownOption(ObjectBody)(endpoint.options), {
    onNone: (): ReadonlyArray<string> => [],
    onSome: ({ body }) => Object.keys(body.shape),
  }),
}));
const bodyKeysOf = (path: string): ReadonlyArray<string> =>
  endpoints.find((e) => e.path === path)?.bodyKeys ?? [];

const classified = [
  ...ADMIN_PATHS_TARGETING_USER_ID,
  ...ADMIN_PATHS_TARGETING_SESSION_TOKEN,
  ...ADMIN_PATHS_REVIEWED_AS_OPEN,
];

describe("admin guard path lists", () => {
  it("name every admin plugin endpoint once, so a Better Auth upgrade that adds one fails here", () => {
    expect([...classified].sort()).toEqual(endpoints.map((e) => e.path).sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it.each(ADMIN_PATHS_TARGETING_USER_ID.map((p) => [p]))(
    "%s takes its target as body.userId, the field the guard reads",
    (path) => {
      expect(bodyKeysOf(path)).toContain("userId");
    }
  );

  it.each(ADMIN_PATHS_TARGETING_SESSION_TOKEN.map((p) => [p]))(
    "%s takes its target as body.sessionToken, the field the guard reads",
    (path) => {
      expect(bodyKeysOf(path)).toContain("sessionToken");
    }
  );
});
