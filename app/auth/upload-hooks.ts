export type PurgeUploads = (userId: string) => Promise<void>;

export const purgeUploadsOnDelete =
  (purge: PurgeUploads | undefined) =>
  async (user: { readonly id: string }): Promise<void> => {
    if (purge) await purge(user.id);
  };
