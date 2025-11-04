import { user } from "@/db/schema";
import { createTRPCRouter, protectedProcedure, publicProcedure } from ".";
import { z } from "zod/v4";

const exampleRouter = createTRPCRouter({
  hello: publicProcedure.query(() => {
    return "Hello World";
  }),
});

const userRouter = createTRPCRouter({
  getUsers: publicProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.user.findMany();
  }),
  getUsersProtected: protectedProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.user.findMany();
  }),
});

export const appRouter = createTRPCRouter({
  example: exampleRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
