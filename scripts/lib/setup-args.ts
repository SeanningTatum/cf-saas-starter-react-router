import { BOOLEAN_FLAGS, FLAG_PREFIX, LIST_SEPARATOR, MODE_FLAGS, SETUP_ENVIRONMENTS, SKIP_ALL, SKIP_FLAG, STDIN_MARK } from "./setup-constants";
import { envVarOf, flagOf, GROUP_NAMES, SETUP_ITEMS, type SetupItem } from "./setup-items";
import { checkValue } from "./setup-validate";

export interface SetupRequest {
  readonly check: boolean;
  readonly yes: boolean;
  readonly provision: boolean;
  readonly security: boolean | undefined;
  readonly rotateAuthSecret: boolean;
  readonly projectName: string | undefined;
  readonly r2: boolean | undefined;
  readonly values: ReadonlyMap<string, string>;
  readonly skips: ReadonlySet<string>;
  readonly errors: ReadonlyArray<string>;
}

export interface ArgSources {
  readonly argv: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readStdin: () => string;
}

interface Pair {
  readonly name: string;
  readonly value: string | undefined;
}

const splitFlag = (token: string): Pair => {
  const body = token.slice(FLAG_PREFIX.length);
  const at = body.indexOf("=");
  return at < 0 ? { name: body, value: undefined } : { name: body.slice(0, at), value: body.slice(at + 1) };
};

const isFlag = (token: string | undefined): token is string => typeof token === "string" && token.startsWith(FLAG_PREFIX) && token.length > FLAG_PREFIX.length;

const tokenize = (argv: ReadonlyArray<string>, errors: string[]): Map<string, string | true> => {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!isFlag(token)) {
      errors.push(`unexpected argument ${token ?? ""}`);
      continue;
    }
    const { name, value } = splitFlag(token);
    if (BOOLEAN_FLAGS.includes(name)) {
      flags.set(name, true);
      continue;
    }
    const next = argv[index + 1];
    const taken = value ?? (next !== undefined && (!isFlag(next) || next === STDIN_MARK) ? next : undefined);
    if (taken === undefined) {
      errors.push(`${FLAG_PREFIX}${name} needs a value`);
      continue;
    }
    if (value === undefined) index += 1;
    flags.set(name, taken);
  }
  return flags;
};

const skipTargets = (token: string): ReadonlyArray<SetupItem> => {
  if (token === SKIP_ALL) return SETUP_ITEMS;
  return SETUP_ITEMS.filter((item) => item.id === token || item.group === token || item.environment === token);
};

const knownSkipToken = (token: string): boolean =>
  token === SKIP_ALL || GROUP_NAMES.includes(token) || SETUP_ENVIRONMENTS.some((name) => name === token) || SETUP_ITEMS.some((item) => item.id === token);

const readSkips = (raw: string | true | undefined, errors: string[]): Set<string> => {
  const skips = new Set<string>();
  if (typeof raw !== "string") return skips;
  for (const token of raw
    .split(LIST_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "")) {
    if (!knownSkipToken(token)) errors.push(`${FLAG_PREFIX}${SKIP_FLAG}: unknown item, group or environment ${token}`);
    for (const item of skipTargets(token)) skips.add(item.id);
  }
  return skips;
};

const itemValue = (
  item: SetupItem,
  flags: Map<string, string | true>,
  env: ArgSources["env"],
  stdin: { used: boolean; read: () => string },
  errors: string[],
): string | undefined => {
  const fromFlag = flags.get(item.id);
  const fromEnv = env[envVarOf(item)];
  const raw = typeof fromFlag === "string" ? fromFlag : fromEnv;
  if (raw === undefined || raw === "") return undefined;
  if (raw !== STDIN_MARK) {
    if (item.secret && typeof fromFlag === "string") {
      errors.push(`${flagOf(item)}: a secret never goes on the command line; use ${flagOf(item)}=${STDIN_MARK} (standard input) or ${envVarOf(item)}`);
      return undefined;
    }
    return raw;
  }
  if (stdin.used) {
    errors.push(`${flagOf(item)}: standard input holds one value; pass this one in ${envVarOf(item)}`);
    return undefined;
  }
  stdin.used = true;
  return stdin.read().replace(/\r?\n$/, "");
};

const tristate = (flags: Map<string, string | true>, on: string, off: string): boolean | undefined => {
  if (flags.has(on)) return true;
  return flags.has(off) ? false : undefined;
};

export const parseSetupArgs = (sources: ArgSources): SetupRequest => {
  const errors: string[] = [];
  const flags = tokenize(sources.argv, errors);
  const stdin = { used: false, read: sources.readStdin };
  const values = new Map<string, string>();
  for (const item of SETUP_ITEMS) {
    const value = itemValue(item, flags, sources.env, stdin, errors);
    if (value === undefined) continue;
    const problem = checkValue(item.check, value);
    if (problem === undefined) values.set(item.id, value);
    else errors.push(`${flagOf(item)}: ${problem}`);
  }
  const known = new Set<string>([...BOOLEAN_FLAGS, MODE_FLAGS.projectName, SKIP_FLAG, ...SETUP_ITEMS.map((item) => item.id)]);
  for (const name of flags.keys()) if (!known.has(name)) errors.push(`unknown option ${FLAG_PREFIX}${name}`);
  const skips = readSkips(flags.get(SKIP_FLAG), errors);
  const projectName = flags.get(MODE_FLAGS.projectName);
  return {
    check: flags.has(MODE_FLAGS.check),
    yes: flags.has(MODE_FLAGS.yes),
    provision: flags.has(MODE_FLAGS.provision),
    security: tristate(flags, MODE_FLAGS.security, MODE_FLAGS.noSecurity),
    rotateAuthSecret: flags.has(MODE_FLAGS.rotateAuthSecret),
    projectName: typeof projectName === "string" ? projectName : undefined,
    r2: tristate(flags, MODE_FLAGS.r2, MODE_FLAGS.noR2),
    values,
    skips,
    errors,
  };
};

export const isResolved = (request: SetupRequest, item: SetupItem): boolean => request.values.has(item.id) || request.skips.has(item.id);

export const allResolved = (request: SetupRequest): boolean => SETUP_ITEMS.every((item) => item.generated === true || isResolved(request, item));
