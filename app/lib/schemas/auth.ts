import { Schema } from "effect";

const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const Email = Schema.String.pipe(
  Schema.pattern(emailPattern, {
    message: () => "Invalid email address",
  })
);

export const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1, { message: () => "Required" })
);

export const Password = Schema.String.pipe(
  Schema.minLength(8, {
    message: () => "Password must be at least 8 characters",
  })
);

export const LoginSchema = Schema.Struct({
  email: Email,
  password: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Password is required" })
  ),
});
export type LoginInput = typeof LoginSchema.Type;

export const SignupSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Name is required" })
  ),
  email: Email,
  password: Password,
  confirmPassword: Schema.String,
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
