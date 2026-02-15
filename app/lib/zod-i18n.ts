import type { ZodErrorMap } from "zod";
import type { TFunction } from "i18next";

export function createZodErrorMap(t: TFunction<"validation">): ZodErrorMap {
  return (issue, ctx) => {
    switch (issue.code) {
      case "invalid_type":
        if (issue.received === "undefined" || issue.received === "null") {
          return { message: t("required") };
        }
        return { message: t("invalid_type") };

      case "invalid_string":
        if (issue.validation === "email") {
          return { message: t("email.invalid") };
        }
        break;

      case "too_small":
        if (issue.type === "string") {
          if (issue.minimum === 1) {
            return { message: t("required") };
          }
          return {
            message: t("string.min", { min: issue.minimum }),
          };
        }
        break;

      case "too_big":
        if (issue.type === "string") {
          return {
            message: t("string.max", { max: issue.maximum }),
          };
        }
        break;

      case "custom":
        if (issue.message) {
          return { message: issue.message };
        }
        break;
    }

    return { message: ctx.defaultError };
  };
}
