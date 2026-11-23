import { describe, expect, it, vi } from "vitest";
import { purgeUploadsOnDelete } from "../upload-hooks";

describe("purgeUploadsOnDelete", () => {
  it("purges the deleted user's uploads before the row goes, so every delete route clears the files", async () => {
    const purge = vi.fn(async () => undefined);
    await purgeUploadsOnDelete(purge)({ id: "u1" });
    expect(purge).toHaveBeenCalledWith("u1");
  });

  it("lets the delete fail when the purge fails, so no file outlives its owner", async () => {
    const purge = vi.fn(async () => {
      throw new Error("r2 down");
    });
    await expect(purgeUploadsOnDelete(purge)({ id: "u1" })).rejects.toThrow("r2 down");
  });

  it("does nothing when no bucket is bound", async () => {
    await expect(purgeUploadsOnDelete(undefined)({ id: "u1" })).resolves.toBeUndefined();
  });
});
