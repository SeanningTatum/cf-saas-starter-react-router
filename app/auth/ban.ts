export interface BanFields {
  readonly banned?: boolean | null;
  readonly banExpires?: Date | null;
}

const banHasRunOut = (banExpires: Date | null | undefined, now: Date): boolean =>
  banExpires != null && new Date(banExpires).getTime() < now.getTime();

export const isBanActive = (user: BanFields, now: Date): boolean =>
  user.banned === true && !banHasRunOut(user.banExpires, now);

export const activeSession = <S extends { readonly user: BanFields }>(
  session: S | null,
  now: Date
): S | null => (session && isBanActive(session.user, now) ? null : session);
