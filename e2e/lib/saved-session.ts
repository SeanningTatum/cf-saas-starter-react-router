import path from "node:path";
import { test } from "@playwright/test";
import type { FIXTURE_ROLES } from "../../app/lib/constants/fixtures";
import { useClientIpPerFile } from "./client-ip";
import { SAVED_SESSION_DIR, type SpecFile } from "./values";

export type FixtureRole = (typeof FIXTURE_ROLES)[number];

export const storageStatePath = (role: FixtureRole): string =>
  path.join(SAVED_SESSION_DIR, `${role}.json`);

export const useSavedSession = (role: FixtureRole, file: SpecFile): string => {
  test.use({ storageState: storageStatePath(role) });
  return useClientIpPerFile(file);
};
