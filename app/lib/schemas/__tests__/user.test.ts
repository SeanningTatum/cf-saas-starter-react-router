import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import {
  GetUsersInput,
  GetUserInput,
  BulkBanUsersInput,
  BulkDeleteUsersInput,
  BulkUpdateUserRolesInput,
  UpdateUserInput,
  UpdateUserData,
  BanUserInput,
  UnbanUserInput,
  DeleteUserInput,
  CreateWorkflowInput,
  DeleteUserSelfCheckInput,
  Role,
  Status,
} from "../user";

const decode = <A, I>(s: Schema.Schema<A, I>) => Schema.decodeUnknownEither(s);

describe("Role", () => {
  it("accepts user", () => {
    expect(decode(Role)("user")._tag).toBe("Right");
  });
  it("accepts admin", () => {
    expect(decode(Role)("admin")._tag).toBe("Right");
  });
  it("rejects unknown role", () => {
    expect(decode(Role)("guest")._tag).toBe("Left");
  });
});

describe("Status", () => {
  it("accepts each variant", () => {
    expect(decode(Status)("verified")._tag).toBe("Right");
    expect(decode(Status)("unverified")._tag).toBe("Right");
    expect(decode(Status)("banned")._tag).toBe("Right");
  });
  it("rejects unknown status", () => {
    expect(decode(Status)("pending")._tag).toBe("Left");
  });
});

describe("GetUsersInput", () => {
  it("applies defaults for page and limit", () => {
    const result = Schema.decodeUnknownSync(GetUsersInput)({});
    expect(result.page).toBe(0);
    expect(result.limit).toBe(10);
  });
  it("rejects negative page", () => {
    expect(decode(GetUsersInput)({ page: -1 })._tag).toBe("Left");
  });
  it("rejects limit > 100", () => {
    expect(decode(GetUsersInput)({ limit: 200 })._tag).toBe("Left");
  });
  it("rejects limit < 1", () => {
    expect(decode(GetUsersInput)({ limit: 0 })._tag).toBe("Left");
  });
  it("accepts full payload", () => {
    expect(
      decode(GetUsersInput)({
        page: 2,
        limit: 50,
        search: "alice",
        role: "user",
        status: "banned",
      })._tag
    ).toBe("Right");
  });
});

describe("BulkBanUsersInput", () => {
  it("rejects empty userIds", () => {
    expect(decode(BulkBanUsersInput)({ userIds: [] })._tag).toBe("Left");
  });
  it("accepts at least one userId", () => {
    expect(decode(BulkBanUsersInput)({ userIds: ["a"] })._tag).toBe("Right");
  });
});

describe("BulkDeleteUsersInput", () => {
  it("rejects empty userIds", () => {
    expect(decode(BulkDeleteUsersInput)({ userIds: [] })._tag).toBe("Left");
  });
});

describe("BulkUpdateUserRolesInput", () => {
  it("requires role", () => {
    expect(
      decode(BulkUpdateUserRolesInput)({ userIds: ["a"] })._tag
    ).toBe("Left");
  });
  it("accepts user role", () => {
    expect(
      decode(BulkUpdateUserRolesInput)({ userIds: ["a"], role: "user" })._tag
    ).toBe("Right");
  });
});

describe("UpdateUserInput", () => {
  it("decodes minimal payload", () => {
    expect(
      decode(UpdateUserInput)({ userId: "u1", data: {} })._tag
    ).toBe("Right");
  });
});

describe("UpdateUserData email pattern", () => {
  it("accepts a well-formed email", () => {
    expect(decode(UpdateUserData)({ email: "a@b.com" })._tag).toBe("Right");
  });

  it("rejects a malformed email", () => {
    expect(decode(UpdateUserData)({ email: "not-an-email" })._tag).toBe(
      "Left"
    );
  });
});

describe("GetUserInput", () => {
  it("decodes a valid userId", () => {
    expect(decode(GetUserInput)({ userId: "u1" })._tag).toBe("Right");
  });
});

describe("BanUserInput", () => {
  it("decodes with only userId", () => {
    expect(decode(BanUserInput)({ userId: "u1" })._tag).toBe("Right");
  });

  it("decodes with reason and expiresAt", () => {
    expect(
      decode(BanUserInput)({
        userId: "u1",
        reason: "spam",
        expiresAt: new Date(),
      })._tag
    ).toBe("Right");
  });
});

describe("UnbanUserInput", () => {
  it("decodes a valid userId", () => {
    expect(decode(UnbanUserInput)({ userId: "u1" })._tag).toBe("Right");
  });
});

describe("DeleteUserInput", () => {
  it("decodes a valid userId", () => {
    expect(decode(DeleteUserInput)({ userId: "u1" })._tag).toBe("Right");
  });
});

describe("CreateWorkflowInput", () => {
  it("decodes email + metadata record", () => {
    expect(
      decode(CreateWorkflowInput)({
        email: "a@b.com",
        metadata: { source: "signup" },
      })._tag
    ).toBe("Right");
  });
});

describe("DeleteUserSelfCheckInput", () => {
  it("decodes a plain string", () => {
    expect(decode(DeleteUserSelfCheckInput)("confirm")._tag).toBe("Right");
  });
});
