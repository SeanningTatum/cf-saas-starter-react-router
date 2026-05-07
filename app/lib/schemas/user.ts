import { Schema } from "effect";

export const Role = Schema.Literal("user", "admin");
export type Role = typeof Role.Type;

export const Status = Schema.Literal("verified", "unverified", "banned");
export type Status = typeof Status.Type;

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
  search: Schema.optional(Schema.String),
  role: Schema.optional(Role),
  status: Schema.optional(Status),
});
export type GetUsersInput = typeof GetUsersInput.Type;

export const GetUserInput = Schema.Struct({
  userId: Schema.String,
});
export type GetUserInput = typeof GetUserInput.Type;

export const UpdateUserData = Schema.Struct({
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/))),
  role: Schema.optional(Role),
  banned: Schema.optional(Schema.Boolean),
  banReason: Schema.optional(Schema.String),
  banExpires: Schema.optional(Schema.DateFromSelf),
  verified: Schema.optional(Schema.Boolean),
});
export type UpdateUserData = typeof UpdateUserData.Type;

export const UpdateUserInput = Schema.Struct({
  userId: Schema.String,
  data: UpdateUserData,
});
export type UpdateUserInput = typeof UpdateUserInput.Type;

export const BanUserInput = Schema.Struct({
  userId: Schema.String,
  reason: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.DateFromSelf),
});
export type BanUserInput = typeof BanUserInput.Type;

export const UnbanUserInput = Schema.Struct({
  userId: Schema.String,
});
export type UnbanUserInput = typeof UnbanUserInput.Type;

export const DeleteUserInput = Schema.Struct({
  userId: Schema.String,
});
export type DeleteUserInput = typeof DeleteUserInput.Type;

export const BulkBanUsersInput = Schema.Struct({
  userIds: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
  reason: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.DateFromSelf),
});
export type BulkBanUsersInput = typeof BulkBanUsersInput.Type;

export const BulkDeleteUsersInput = Schema.Struct({
  userIds: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
});
export type BulkDeleteUsersInput = typeof BulkDeleteUsersInput.Type;

export const BulkUpdateUserRolesInput = Schema.Struct({
  userIds: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
  role: Role,
});
export type BulkUpdateUserRolesInput = typeof BulkUpdateUserRolesInput.Type;

export const CreateWorkflowInput = Schema.Struct({
  email: Schema.String,
  metadata: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type CreateWorkflowInput = typeof CreateWorkflowInput.Type;

export const DeleteUserSelfCheckInput = Schema.String;
