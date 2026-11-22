import { Effect, Schema } from "effect";
import { createTRPCRouter, protectedProcedure } from ".";
import { runProcedure } from "@/lib/effect-trpc";
import { Workflows } from "@/services/workflows";
import { CreateWorkflowInput } from "@/lib/schemas/user";
import { adminRouter } from "./routes/admin";
import { analyticsRouter } from "./routes/analytics";

const userRouter = createTRPCRouter({
  // No `getUsers` here: it listed other users to any signed-in user. Use
  // `admin.getUsers`; app/trpc/__tests__/router.test.ts fails if it comes back.

  // No `deleteUser` here. It used to sit behind `protectedProcedure`, which
  // let any signed-in user delete any non-admin account by id. Deleting an
  // account by id is admin-only: `admin.deleteUser` in routes/admin.ts.
  // app/trpc/__tests__/router.test.ts fails if it comes back.

  createWorkflow: protectedProcedure
    .input(Schema.standardSchemaV1(CreateWorkflowInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const wf = yield* Workflows;
          return yield* wf.triggerExample(input);
        }),
        { span: "trpc.user.createWorkflow" }
      )
    ),
});

export const appRouter = createTRPCRouter({
  user: userRouter,
  admin: adminRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;
