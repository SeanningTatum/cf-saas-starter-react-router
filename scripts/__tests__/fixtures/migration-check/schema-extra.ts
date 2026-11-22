import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export * from "../../../../app/db/schema";

export const driftProbe = sqliteTable("drift_probe", {
  id: text("id").primaryKey(),
});
