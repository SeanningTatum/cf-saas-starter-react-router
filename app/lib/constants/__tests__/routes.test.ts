import type { RouteConfigEntry } from "@react-router/dev/routes";
import { describe, expect, it } from "vitest";
import routeTable from "@/routes";
import { API_ROUTES, ROUTES } from "../routes";

const normalise = (path: string): string => `/${path.split("/").filter(Boolean).join("/")}`;

function servedPaths(entries: readonly RouteConfigEntry[], base = "/"): string[] {
  return entries.flatMap((entry) => {
    const own = entry.path ? normalise(`${base}/${entry.path}`) : base;
    return [own, ...servedPaths(entry.children ?? [], own)];
  });
}

const fixedPaths = (): string[] =>
  [...new Set(servedPaths(routeTable).map((path) => path.replace(/\/\*$/, "")))]
    .filter((path) => !path.includes(":"))
    .sort();

describe("route constants", () => {
  it("hold every fixed path app/routes.ts serves and no path it does not, so a renamed route cannot leave a dead link behind", () => {
    const constants = [...Object.values(ROUTES), ...Object.values(API_ROUTES)].sort();

    expect(constants).toEqual(fixedPaths());
  });

  it("keep page paths and API paths apart, so a redirect is never pointed at an endpoint", () => {
    expect(Object.values(ROUTES).filter((path) => path.startsWith("/api/"))).toEqual([]);
    expect(Object.values(API_ROUTES).filter((path) => !path.startsWith("/api/"))).toEqual([]);
  });
});
