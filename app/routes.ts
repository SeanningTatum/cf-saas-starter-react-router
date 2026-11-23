import { type RouteConfig, index, route, prefix, layout } from "@react-router/dev/routes";
import { BROWSER_REPORT_PATH } from "./lib/constants/error-reporting";
import { HEALTHZ_PATH } from "./lib/constants/health";
import { SANDBOX_BUILD } from "./lib/sandbox/build";

export default [
  route("/api/trpc/*", "routes/api/trpc.$.ts"),
  route("/api/auth/*", "routes/api/auth.$.ts"),
  route("/api/upload-file", "routes/api/upload-file.ts"),
  route("/api/uploads/:id", "routes/api/upload-object.ts"),
  route("/api/set-locale", "routes/api/set-locale.ts"),
  route(BROWSER_REPORT_PATH, "routes/api/browser-report.ts"),
  route(HEALTHZ_PATH, "routes/api/healthz.ts"),
  ...(SANDBOX_BUILD ? [route("/sandbox.json", "routes/sandbox/manifest.ts")] : []),

  index("routes/home.tsx"),
  route("/login", "routes/authentication/login.tsx"),
  route("/sign-up", "routes/authentication/sign-up.tsx"),

  ...prefix(":lng", [
    index("routes/home.tsx", { id: "lng-home" }),
    route("/login", "routes/authentication/login.tsx", { id: "lng-login" }),
    route("/sign-up", "routes/authentication/sign-up.tsx", { id: "lng-sign-up" }),
  ]),

  ...prefix("dashboard", [
    layout("routes/dashboard/_layout.tsx", [route("/", "routes/dashboard/_index.tsx")]),
  ]),

  ...prefix("admin", [
    layout("routes/admin/_layout.tsx", [
      route("/", "routes/admin/_index.tsx"),
      route("/users", "routes/admin/users.tsx"),
      route("/kitchen-sink", "routes/admin/kitchen-sink.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
