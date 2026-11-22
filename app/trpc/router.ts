import { createTRPCRouter } from ".";
import { adminRouter } from "./routes/admin";
import { analyticsRouter } from "./routes/analytics";

// No `user` router: `user.getUsers` and `user.deleteUser` were holes, and
// __tests__/router.test.ts fails if either comes back.
export const appRouter = createTRPCRouter({
  admin: adminRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;
