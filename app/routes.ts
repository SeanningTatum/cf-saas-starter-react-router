import {
  type RouteConfig,
  index,
  route,
  prefix,
  layout,
} from "@react-router/dev/routes";

// Public/landing pages — SEO-visible, get /:lng prefix variants
const publicRoutes = [
  index("routes/home.tsx"),
  route("/login", "routes/authentication/login.tsx"),
  route("/sign-up", "routes/authentication/sign-up.tsx"),
];

export default [
  // API Routes (no locale prefix)
  route("/api/trpc/*", "routes/api/trpc.$.ts"),
  route("/api/auth/*", "routes/api/auth.$.ts"),
  route("/api/upload-file", "routes/api/upload-file.ts"),

  // Public routes at root (default locale)
  ...publicRoutes,

  // Public routes with locale prefix (for SEO)
  ...prefix(":lng", publicRoutes),

  // Dashboard routes — auth-protected, client-side i18n only
  ...prefix("dashboard", [
    layout("routes/dashboard/_layout.tsx", [
      route("/", "routes/dashboard/_index.tsx"),
    ]),
  ]),

  // Admin routes — client-side i18n only, no locale prefix
  ...prefix("admin", [
    layout("routes/admin/_layout.tsx", [
      route("/", "routes/admin/_index.tsx"),
      route("/users", "routes/admin/users.tsx"),
      route("/docs/:category?/:doc?", "routes/admin/docs.tsx"),
      route("/kitchen-sink", "routes/admin/kitchen-sink.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
