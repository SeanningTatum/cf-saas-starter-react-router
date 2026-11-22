import { describe, expect, it } from "vitest";
import { TABLE_ROW_PATTERN, WORKER_LABEL, routeKey, routeLabel } from "../size-constants";

describe("size-constants", () => {
  it("keys a route row by its id and kind, so a row keeps its place when the page's path changes", () => {
    expect(routeKey("routes/dashboard/_index", "js")).toBe("route:routes/dashboard/_index:js");
    expect(routeKey("routes/home", "css")).toBe("route:routes/home:css");
  });

  it("labels a route row by its path in code font", () => {
    expect(routeLabel("/dashboard", "js")).toBe("`/dashboard` first-load JS, gzip");
    expect(routeLabel("/", "css")).toBe("`/` first-load CSS, gzip");
  });

  it("the PR body check looks for the same Worker label the table prints: renaming one without the other fails every PR", () => {
    expect(TABLE_ROW_PATTERN.test(`| ${WORKER_LABEL} | 1 | 2 | +1 |`)).toBe(true);
  });
});
