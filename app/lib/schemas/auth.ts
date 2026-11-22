import { Schema } from "effect";

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const Email = Schema.String.pipe(
  Schema.maxLength(254, {
    message: () => "Email must be at most 254 characters",
  }),
  Schema.pattern(emailPattern, {
    message: () => "Invalid email address",
  }),
);

const PASSWORD_MAX = 128;

const passwordTooLong = {
  message: () => `Password must be at most ${PASSWORD_MAX} characters`,
};

export const Password = Schema.String.pipe(
  Schema.minLength(8, {
    message: () => "Password must be at least 8 characters",
  }),
  Schema.maxLength(PASSWORD_MAX, passwordTooLong),
);

export const LoginSchema = Schema.Struct({
  email: Email,
  password: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Password is required" }),
    Schema.maxLength(PASSWORD_MAX, passwordTooLong),
  ),
});
export type LoginInput = typeof LoginSchema.Type;

export const SignupSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Name is required" }),
    Schema.maxLength(100, {
      message: () => "Name must be at most 100 characters",
    }),
  ),
  email: Email,
  password: Password,
  confirmPassword: Schema.String.pipe(Schema.maxLength(PASSWORD_MAX, passwordTooLong)),
}).pipe(
  Schema.filter((data) =>
    data.password === data.confirmPassword
      ? undefined
      : {
          path: ["confirmPassword"],
          message: "Passwords do not match",
        },
  ),
);
export type SignupInput = typeof SignupSchema.Type;
