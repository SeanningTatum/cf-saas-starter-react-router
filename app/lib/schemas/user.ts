import { Schema } from "effect";
import { Email } from "./auth";
import { MAX_BULK_USER_IDS } from "@/lib/constants/db";

export const Role = Schema.Literal("user", "admin");
export type Role = typeof Role.Type;

export const Status = Schema.Literal("verified", "unverified", "banned");
export type Status = typeof Status.Type;

const UserId = Schema.String.pipe(Schema.maxLength(128));

export { MAX_BULK_USER_IDS };

const BulkUserIds = Schema.Array(UserId).pipe(
  Schema.minItems(1),
  Schema.maxItems(MAX_BULK_USER_IDS)
);

const BanReason = Schema.String.pipe(Schema.maxLength(500));

const BanExpiry = Schema.ValidDateFromSelf;

export const GetUsersInput = Schema.Struct({
  page: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
    Schema.optionalWith({ default: () => 0 })
  ),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(100),
    Schema.optionalWith({ default: () => 10 })
  ),
  search: Schema.optional(Schema.String.pipe(Schema.maxLength(100))),
  role: Schema.optional(Role),
  status: Schema.optional(Status),
});
export type GetUsersInput = typeof GetUsersInput.Type;

export const GetUserInput = Schema.Struct({
  userId: UserId,
});
export type GetUserInput = typeof GetUserInput.Type;

export const UpdateUserData = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.maxLength(100))),
  email: Schema.optional(Email),
  role: Schema.optional(Role),
  banned: Schema.optional(Schema.Boolean),
  banReason: Schema.optional(BanReason),
  banExpires: Schema.optional(BanExpiry),
  verified: Schema.optional(Schema.Boolean),
});
export type UpdateUserData = typeof UpdateUserData.Type;

export const UpdateUserInput = Schema.Struct({
  userId: UserId,
  data: UpdateUserData,
});
export type UpdateUserInput = typeof UpdateUserInput.Type;

export const BanUserInput = Schema.Struct({
  userId: UserId,
  reason: Schema.optional(BanReason),
  expiresAt: Schema.optional(BanExpiry),
});
export type BanUserInput = typeof BanUserInput.Type;

export const UnbanUserInput = Schema.Struct({
  userId: UserId,
});
export type UnbanUserInput = typeof UnbanUserInput.Type;

export const DeleteUserInput = Schema.Struct({
  userId: UserId,
});
export type DeleteUserInput = typeof DeleteUserInput.Type;

export const BulkBanUsersInput = Schema.Struct({
  userIds: BulkUserIds,
  reason: Schema.optional(BanReason),
  expiresAt: Schema.optional(BanExpiry),
});
export type BulkBanUsersInput = typeof BulkBanUsersInput.Type;

export const BulkDeleteUsersInput = Schema.Struct({
  userIds: BulkUserIds,
});
export type BulkDeleteUsersInput = typeof BulkDeleteUsersInput.Type;

export const BulkUpdateUserRolesInput = Schema.Struct({
  userIds: BulkUserIds,
  role: Role,
});
export type BulkUpdateUserRolesInput = typeof BulkUpdateUserRolesInput.Type;
