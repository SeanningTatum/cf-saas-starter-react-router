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
  trpc: "/api/trpc",
  auth: "/api/auth",
  uploadFile: "/api/upload-file",
  setLocale: "/api/set-locale",
} as const;
