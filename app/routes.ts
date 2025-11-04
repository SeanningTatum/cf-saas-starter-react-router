import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/api/trpc/*", "routes/api/trpc.$.ts"),
  route("/api/auth/*", "routes/api/auth.$.ts"),

  // Bucket routes
  route("/bucket", "routes/bucket/index.tsx"),
  route("/bucket/upload", "routes/bucket/upload.tsx"),
  route("/bucket/list", "routes/bucket/list.tsx"),
  route("/bucket/delete", "routes/bucket/delete.tsx"),
  route("/bucket/get/:key", "routes/bucket/get.$key.tsx"),
] satisfies RouteConfig;
