import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { LoginSchema, SignupSchema, Email, Password } from "../auth";

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
  it("accepts 8+ characters", () => {
    expect(decode(Password)("12345678")._tag).toBe("Right");
  });
  it("rejects shorter passwords", () => {
    expect(decode(Password)("short")._tag).toBe("Left");
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
