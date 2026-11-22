import { describe, expect, it } from "vitest";
import { isProtectedUser } from "../protected-user";

describe("isProtectedUser", () => {
  it("protects an admin from another admin", () => {
    expect(isProtectedUser({ role: "admin", id: "u1" }, "u2")).toBe(true);
  });
  it("protects the caller from acting on themself", () => {
    expect(isProtectedUser({ role: "user", id: "u1" }, "u1")).toBe(true);
  });
  it("leaves a plain user who is not the caller open to admin actions", () => {
    expect(isProtectedUser({ role: "user", id: "u1" }, "u2")).toBe(false);
  });
  it("protects the caller even when their role is null", () => {
    expect(isProtectedUser({ role: null, id: "u1" }, "u1")).toBe(true);
  });
  it("leaves a user with no role open when they are not the caller", () => {
    expect(isProtectedUser({ id: "u1" }, "u2")).toBe(false);
  });
  it("protects a user whose role list includes admin, as Better Auth reads it", () => {
    expect(isProtectedUser({ role: "user,admin", id: "u1" }, "u2")).toBe(true);
    expect(isProtectedUser({ role: "user, admin", id: "u1" }, "u2")).toBe(true);
  });
});
