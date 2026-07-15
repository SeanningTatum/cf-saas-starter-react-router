import { Effect, Schema } from "effect";
import { createTRPCRouter, protectedProcedure } from ".";
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
  // Fix 1 (audit): this was a `publicProcedure` returning full user rows
  // (email, role, ban reason, verification status) with no auth check at
  // all. Grepped every client call site (`api.user.getUsers`,
  // `trpc.user.getUsers`) — nothing in the app consumes this endpoint or
  // its `getUsersProtected` twin; the admin users page
  // (app/routes/admin/users.tsx) calls the separate, already-gated
  // `admin.getUsers` (adminProcedure) in app/trpc/routes/admin.ts, which is
  // untouched by this change. Since this isn't admin-UI-only (it has no
  // consumers to be "only admin UI"), per the fix instructions the
  // safe default is `protectedProcedure` + a safe projection — auth
  // required, and only non-sensitive fields returned. The duplicate
  // `getUsersProtected` procedure (same body, no callers) is folded into
  // this one rather than kept as a second unauthenticated-adjacent surface.
  getUsers: protectedProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const res = yield* repo.getUsers({ page: 0, limit: 100 });
        return res.users.map((u) => ({
          id: u.id,
          name: u.name,
          image: u.image,
          createdAt: u.createdAt,
        }));
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
