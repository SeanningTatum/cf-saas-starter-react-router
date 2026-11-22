import { Schema } from "effect";
import {
  EMAIL_PATTERN,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/constants/auth";

export const Email = Schema.String.pipe(
  Schema.maxLength(254, {
    message: () => "Email must be at most 254 characters",
  }),
  Schema.pattern(EMAIL_PATTERN, {
    message: () => "Invalid email address",
  })
);

export const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1, { message: () => "Required" })
);

const passwordTooLong = {
  message: () => `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
};

export const Password = Schema.String.pipe(
  Schema.minLength(PASSWORD_MIN_LENGTH, {
    message: () => `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  }),
  Schema.maxLength(PASSWORD_MAX_LENGTH, passwordTooLong)
);

export const LoginSchema = Schema.Struct({
  email: Email,
  password: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Password is required" }),
    Schema.maxLength(PASSWORD_MAX_LENGTH, passwordTooLong)
  ),
});
export type LoginInput = typeof LoginSchema.Type;

export const SignupSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Name is required" }),
    Schema.maxLength(100, {
      message: () => "Name must be at most 100 characters",
    })
  ),
  email: Email,
  password: Password,
  confirmPassword: Schema.String.pipe(
    Schema.maxLength(PASSWORD_MAX_LENGTH, passwordTooLong)
  ),
}).pipe(
  Schema.filter((data) =>
    data.password === data.confirmPassword
      ? undefined
      : {
          path: ["confirmPassword"],
          message: "Passwords do not match",
        }
  )
);
export type SignupInput = typeof SignupSchema.Type;
