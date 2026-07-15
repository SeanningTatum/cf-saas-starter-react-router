import type common from "../locales/en/common.json";
import type auth from "../locales/en/auth.json";
import type admin from "../locales/en/admin.json";
import type home from "../locales/en/home.json";
import type validation from "../locales/en/validation.json";
import type upload from "../locales/en/upload.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      auth: typeof auth;
      admin: typeof admin;
      home: typeof home;
      validation: typeof validation;
      upload: typeof upload;
    };
  }
}
