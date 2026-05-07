import { Effect, Schema } from "effect";
import { createTRPCRouter, protectedProcedure, publicProcedure } from ".";
import { runProcedure } from "@/lib/effect-trpc";
import { UserRepository } from "@/repositories/user";
import { Workflows } from "@/services/workflows";
import {
  CreateWorkflowInput,
  DeleteUserSelfCheckInput,
} from "@/lib/schemas/user";
import { ValidationError } from "@/models/errors/repository";
import { adminRouter } from "./routes/admin";
import { analyticsRouter } from "./routes/analytics";

const userRouter = createTRPCRouter({
  getUsers: publicProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const res = yield* repo.getUsers({ page: 0, limit: 100 });
        return res.users;
      })
    )
  ),

  getUsersProtected: protectedProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const res = yield* repo.getUsers({ page: 0, limit: 100 });
        return res.users;
      })
    )
  ),

  deleteUser: protectedProcedure
    .input(Schema.standardSchemaV1(DeleteUserSelfCheckInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          if (ctx.auth.user?.id === input) {
            return yield* Effect.fail(
              new ValidationError({
                entity: "user",
                message: "Cannot delete self",
                field: "userId",
              })
            );
          }
          const repo = yield* UserRepository;
          return yield* repo.deleteUser({
            userId: input,
            currentUserId: ctx.auth.user.id,
          });
        })
      )
    ),

  createWorkflow: protectedProcedure
    .input(Schema.standardSchemaV1(CreateWorkflowInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const wf = yield* Workflows;
          return yield* wf.triggerExample(input);
        })
      )
    ),
});

export const appRouter = createTRPCRouter({
  user: userRouter,
  admin: adminRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;
