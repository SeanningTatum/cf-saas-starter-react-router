import { BROWSER_REPORT_PATH } from "./error-reporting";
import { HEALTHZ_PATH } from "./health";

export const ROUTES = {
  home: "/",
  login: "/login",
  signUp: "/sign-up",
  dashboard: "/dashboard",
  admin: "/admin",
  adminUsers: "/admin/users",
  adminKitchenSink: "/admin/kitchen-sink",
} as const;

export const API_ROUTES = {
  browserReport: BROWSER_REPORT_PATH,
  trpc: "/api/trpc",
  auth: "/api/auth",
  uploadFile: "/api/upload-file",
  setLocale: "/api/set-locale",
} as const;

export const OPS_ROUTES = {
  healthz: HEALTHZ_PATH,
} as const;
