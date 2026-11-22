import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { API_ROUTES } from "@/lib/constants/routes";

export const authClient = createAuthClient({
  basePath: API_ROUTES.auth,
  plugins: [adminClient()],
});
