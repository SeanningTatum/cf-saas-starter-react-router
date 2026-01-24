import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb(database: D1Database) {
  try {
    return drizzleD1(database, { schema, logger: false });
  } catch (err) {
    throw new Error("Database not available");
  }
}
