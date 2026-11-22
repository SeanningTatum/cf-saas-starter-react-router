import { describe, expect, it } from "vitest";
import {
  BYTES_PER_MIB,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MIB,
  exportTooLarge,
  stepFailed,
  stepTimedOut,
  summaryExport,
} from "../d1-backup-constants";

describe("d1-backup-constants builders", () => {
  it("holds the upload limit as 300 MiB in bytes: a wrong factor would let an oversized dump reach wrangler", () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_UPLOAD_MIB * BYTES_PER_MIB);
    expect(MAX_UPLOAD_BYTES).toBe(314_572_800);
  });

  it("says a timed-out step in seconds, not milliseconds", () => {
    expect(stepTimedOut("export the database", 300_000)).toContain("timed out after 300 seconds");
  });

  it("names the failed step and its exit code, and says the migration will not run", () => {
    const line = stepFailed("upload the export to R2", 2);
    expect(line.startsWith("::error::")).toBe(true);
    expect(line).toContain("upload the export to R2 (exit 2)");
    expect(line).toContain("the migration will not run");
  });

  it("rounds an oversized export up to whole MiB and gives the way out", () => {
    const line = exportTooLarge(MAX_UPLOAD_BYTES + 1);
    expect(line).toContain("is 301 MiB, over the 300 MiB limit");
    expect(line).toContain("D1_BACKUP_BUCKET");
  });

  it("does not claim a retention the code cannot check: the lifecycle rule sets it", () => {
    const line = summaryExport("d1-exports/x.sql.gz");
    expect(line).toContain("d1-exports/x.sql.gz");
    expect(line).toContain("lifecycle rule sets how long it is kept");
  });
});
