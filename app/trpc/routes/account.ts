import { Effect } from "effect";
import { createTRPCRouter, protectedProcedure } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { AccountRepository } from "@/repositories/account";

export const accountRouter = createTRPCRouter({
  exportData: protectedProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AccountRepository;
        return yield* repo.exportData(ctx.auth.user.id);
      }),
      { span: "trpc.account.exportData" },
    ),
  ),

  deleteAccount: protectedProcedure.mutation(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AccountRepository;
        return yield* repo.deleteAccount(ctx.auth.user.id);
      }),
      { span: "trpc.account.deleteAccount" },
    ),
  ),
});
