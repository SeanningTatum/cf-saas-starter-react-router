import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(database: D1Database) {
  return drizzleD1(database, { schema, logger: false });
}
