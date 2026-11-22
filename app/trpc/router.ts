import { createTRPCRouter } from ".";
import { adminRouter } from "./routes/admin";
import { analyticsRouter } from "./routes/analytics";

export const appRouter = createTRPCRouter({
  admin: adminRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;
