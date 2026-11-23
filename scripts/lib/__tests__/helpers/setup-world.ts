import type { RunOptions, RunResult, Runner } from "../../setup-run";

export interface Call {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly input: string | undefined;
  readonly env: Readonly<Record<string, string>> | undefined;
}

export interface World {
  readonly calls: Call[];
  readonly secrets: Record<string, Set<string>>;
  readonly ghSecrets: Set<string>;
  readonly ghEnvSecrets: Record<string, Set<string>>;
  readonly ghVariables: Set<string>;
  readonly environments: Set<string>;
  settings: { alerts: boolean; scanning: boolean; reports: boolean };
  workersExist: boolean;
  ghWorks: boolean;
  denySettings: boolean;
}

export const newWorld = (): World => ({
  calls: [],
  secrets: { production: new Set(), preview: new Set(), staging: new Set() },
  ghSecrets: new Set(),
  ghEnvSecrets: { production: new Set(), staging: new Set() },
  ghVariables: new Set(),
  environments: new Set(),
  settings: { alerts: false, scanning: false, reports: false },
  workersExist: true,
  ghWorks: true,
  denySettings: false,
});

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const bad = (stderr: string): RunResult => ({ code: 1, stdout: "", stderr });
const names = (set: Set<string>): RunResult => ok(JSON.stringify([...set].map((name) => ({ name }))));

const flagAfter = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
};

const wranglerCall = (world: World, args: ReadonlyArray<string>, input: string | undefined): RunResult => {
  const environment = flagAfter(args, "--env") ?? "production";
  const store = world.secrets[environment];
  if (!world.workersExist || store === undefined) return bad("This Worker does not exist");
  if (args.includes("list")) return names(store);
  const name = args[args.indexOf("put") + 1] ?? "";
  if (input === undefined || input === "") return bad("no value");
  store.add(name);
  return ok();
};

const environmentApi = (world: World, endpoint: string, write: boolean): RunResult => {
  const name = endpoint.split("/").pop() ?? "";
  if (write) {
    world.environments.add(name);
    return ok();
  }
  return world.environments.has(name) ? ok(JSON.stringify({ protection_rules: [{ type: "required_reviewers" }] })) : bad("gh: Not Found (HTTP 404)");
};

const settingsApi = (world: World, endpoint: string, write: boolean): RunResult => {
  if (endpoint.endsWith("vulnerability-alerts")) {
    if (write) world.settings.alerts = true;
    return write || world.settings.alerts ? ok() : bad("gh: Not Found (HTTP 404)");
  }
  if (endpoint.endsWith("private-vulnerability-reporting")) {
    if (write) world.settings.reports = true;
    return ok(JSON.stringify({ enabled: world.settings.reports }));
  }
  if (write) world.settings.scanning = true;
  const status = world.settings.scanning ? "enabled" : "disabled";
  return ok(JSON.stringify({ security_and_analysis: { secret_scanning: { status }, secret_scanning_push_protection: { status } } }));
};

const ghApi = (world: World, args: ReadonlyArray<string>): RunResult => {
  const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
  const write = args.includes("PUT") || args.includes("PATCH");
  if (endpoint.includes("/environments/")) return environmentApi(world, endpoint, write);
  if (world.denySettings && write) return bad("gh: Resource not accessible (HTTP 403)");
  return settingsApi(world, endpoint, write);
};

const secretStore = (world: World, environment: string | undefined): Set<string> => {
  if (environment === undefined) return world.ghSecrets;
  const store = world.ghEnvSecrets[environment] ?? new Set<string>();
  world.ghEnvSecrets[environment] = store;
  return store;
};

const ghCall = (world: World, args: ReadonlyArray<string>, input: string | undefined): RunResult => {
  if (!world.ghWorks) return bad("gh: not logged in");
  const [area, verb] = args;
  if (area === "api") return ghApi(world, args);
  const store = secretStore(world, flagAfter(args, "--env"));
  if (area === "secret" && verb === "list") return names(store);
  if (area === "variable" && verb === "list") return names(world.ghVariables);
  if (area === "secret" && verb === "set") {
    if (input === undefined || input === "") return bad("no value");
    store.add(args[2] ?? "");
    return ok();
  }
  if (area === "variable" && verb === "set") {
    world.ghVariables.add(args[2] ?? "");
    return ok();
  }
  return bad(`unhandled gh ${args.join(" ")}`);
};

export const worldRunner = (world: World): Runner => {
  return (file: string, args: ReadonlyArray<string>, options?: RunOptions): RunResult => {
    world.calls.push({ file, args: [...args], input: options?.input, env: options?.env });
    if (file === "gh") return ghCall(world, args, options?.input);
    if (file === "bunx" && args[0] === "wrangler") return wranglerCall(world, args.slice(1), options?.input);
    return bad(`unhandled ${file}`);
  };
};

export const everythingSaid = (world: World): string =>
  world.calls.map((call) => [call.file, ...call.args, JSON.stringify(call.env ?? {})].join(" ")).join("\n");
