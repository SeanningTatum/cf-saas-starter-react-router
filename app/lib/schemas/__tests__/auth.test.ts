import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { LoginSchema, SignupSchema, Email, Password } from "../auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants/auth";

const decode = <A, I>(schema: Schema.Schema<A, I>) =>
  Schema.decodeUnknownEither(schema);

describe("Email", () => {
  it("accepts valid emails", () => {
    const result = decode(Email)("a@b.co");
    expect(result._tag).toBe("Right");
  });
  it("rejects invalid emails", () => {
    const result = decode(Email)("not-an-email");
    expect(result._tag).toBe("Left");
  });
});

describe("Password", () => {
  it("accepts the shared minimum and rejects one under it, so the form never passes a password Better Auth refuses", () => {
    expect(decode(Password)("a".repeat(PASSWORD_MIN_LENGTH))._tag).toBe("Right");
    expect(decode(Password)("a".repeat(PASSWORD_MIN_LENGTH - 1))._tag).toBe("Left");
  });
  it("names the shared limits in its messages", () => {
    const messageFor = (value: string) => {
      const result = Schema.decodeUnknownEither(Password, { errors: "first" })(value);
      return result._tag === "Left" ? result.left.message : "";
    };
    expect(messageFor("short")).toContain(`at least ${PASSWORD_MIN_LENGTH} characters`);
    expect(messageFor("a".repeat(PASSWORD_MAX_LENGTH + 1))).toContain(
      `at most ${PASSWORD_MAX_LENGTH} characters`
    );
  });
});

describe("LoginSchema", () => {
  it("decodes a valid login payload", () => {
    const result = decode(LoginSchema)({
      email: "a@b.co",
      password: "anything",
    });
    expect(result._tag).toBe("Right");
  });
  it("rejects an empty password", () => {
    expect(
      decode(LoginSchema)({ email: "a@b.co", password: "" })._tag
    ).toBe("Left");
  });
  it("rejects an invalid email", () => {
    expect(
      decode(LoginSchema)({ email: "bad", password: "x" })._tag
    ).toBe("Left");
  });
});

// Catches: a cap dropped or loosened, letting the form accept a field the
// server (or Better Auth, for passwords over 128) would refuse. One row per
// cap; SignupSchema.password is `Password`, so its row covers both.
describe("form caps: at the cap decodes, one over fails", () => {
  const s = (n: number) => "a".repeat(n);
  const email = (n: number) => `${"a".repeat(n - "@b.co".length)}@b.co`;
  const signup = (fields: Record<string, string>) => ({
    name: "Alice",
    email: "a@b.co",
    password: "12345678",
    confirmPassword: "12345678",
    ...fields,
  });
  const cases: ReadonlyArray<
    [
      string,
      (u: unknown) => { readonly _tag: "Left" | "Right" },
      number,
      (n: number) => unknown,
    ]
  > = [
    ["Email", decode(Email), 254, email],
    ["Password", decode(Password), PASSWORD_MAX_LENGTH, s],
    [
      "LoginSchema.password",
      decode(LoginSchema),
      PASSWORD_MAX_LENGTH,
      (n) => ({ email: "a@b.co", password: s(n) }),
    ],
    ["SignupSchema.name", decode(SignupSchema), 100, (n) => signup({ name: s(n) })],
  ];
  for (const [name, check, cap, build] of cases) {
    it(`${name}: ${cap} decodes, ${cap + 1} fails`, () => {
      expect(check(build(cap))._tag).toBe("Right");
      expect(check(build(cap + 1))._tag).toBe("Left");
    });
  }
});

describe("SignupSchema", () => {
  it("decodes a valid signup payload", () => {
    expect(
      decode(SignupSchema)({
        name: "Alice",
        email: "a@b.co",
        password: "12345678",
        confirmPassword: "12345678",
      })._tag
    ).toBe("Right");
  });
  it("rejects mismatched passwords", () => {
    const result = decode(SignupSchema)({
      name: "Alice",
      email: "a@b.co",
      password: "12345678",
      confirmPassword: "abcdefgh",
    });
    expect(result._tag).toBe("Left");
  });
  it("rejects short password", () => {
    expect(
      decode(SignupSchema)({
        name: "Alice",
        email: "a@b.co",
        password: "short",
        confirmPassword: "short",
      })._tag
    ).toBe("Left");
  });
  it("rejects empty name", () => {
    expect(
      decode(SignupSchema)({
        name: "",
        email: "a@b.co",
        password: "12345678",
        confirmPassword: "12345678",
      })._tag
    ).toBe("Left");
  });
});
