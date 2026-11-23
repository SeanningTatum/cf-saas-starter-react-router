import { createTRPCRouter } from ".";
import { accountRouter } from "./routes/account";
import { adminRouter } from "./routes/admin";
import { analyticsRouter } from "./routes/analytics";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  admin: adminRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;
