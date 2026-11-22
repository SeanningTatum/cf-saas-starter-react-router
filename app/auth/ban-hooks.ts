import type { GenericEndpointContext } from "better-auth";
import { eq } from "drizzle-orm";
import { session as sessionTable } from "@/db/schema";
import type { DrizzleD1 } from "@/services/database";
import { isBanActive, type BanFields } from "./ban";

export type SessionStore = Pick<DrizzleD1, "delete">;

export const clearExpiryOnOpenBan = async <D extends Record<string, unknown>>(
  data: D
): Promise<{ readonly data: D & { readonly banExpires: null } } | undefined> =>
  data.banned === true && data.banExpires === undefined
    ? { data: { ...data, banExpires: null } }
    : undefined;

export const endSessionsOnBan =
  (sessionsWithoutEndpoint: SessionStore) =>
  async (
    user: ({ readonly id: string } & BanFields) | null,
    context: GenericEndpointContext | null
  ): Promise<void> => {
    if (!user || !isBanActive(user, new Date())) return;
    if (context) {
      await context.context.internalAdapter.deleteSessions(user.id);
      return;
    }
    await sessionsWithoutEndpoint
      .delete(sessionTable)
      .where(eq(sessionTable.userId, user.id));
  };
