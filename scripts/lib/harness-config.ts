import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Either, ParseResult, Schema } from "effect";
import {
  BAD_GATE_FIELD_LINE,
  BAD_JSON_LINE,
  CONFIG_FILE_NAME,
  CONFIG_VERSION,
  DEFAULT_COAUTHOR,
  DEFAULT_DOCS,
  DEFAULT_LOGIN_FORM,
  DEFAULT_READY_LABEL,
  DEFAULT_REVIEW_BOT,
  DEFAULT_SCRATCH_DIRS,
  GATE_FORBIDDEN_CHARACTERS,
  KEY_SEPARATOR,
  MESSAGE_PREFIX,
  NOT_FOUND_CODE,
} from "./harness-config-constants";
import { ledgerChecksum } from "./run-telemetry";

const GateField = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((text) => !GATE_FORBIDDEN_CHARACTERS.test(text), { message: () => BAD_GATE_FIELD_LINE }),
);

const GateSchema = Schema.Struct({
  name: GateField,
  run: GateField,
  baseline: Schema.Boolean,
  limitSeconds: Schema.Int.pipe(Schema.positive()),
});

const TrackerSchema = Schema.Struct({ readyLabel: Schema.String.pipe(Schema.minLength(1)) });

const ReviewBotSchema = Schema.Struct({
  login: Schema.String.pipe(Schema.minLength(1)),
  summaryMarker: Schema.String.pipe(Schema.minLength(1)),
  trigger: Schema.String.pipe(Schema.minLength(1)),
});

const DocsSchema = Schema.Struct({
  product: Schema.String,
  design: Schema.String,
  glossary: Schema.String,
  adr: Schema.String,
  features: Schema.String,
});

const LoginFormSchema = Schema.Struct({
  path: Schema.String,
  emailTestId: Schema.String,
  passwordTestId: Schema.String,
  submitTestId: Schema.String,
});

const SeedLoginSchema = Schema.Struct({ email: Schema.String, password: Schema.String });

const PathsSchema = Schema.Struct({
  sourceRoots: Schema.Array(Schema.String),
  tokens: Schema.String,
  rootLayout: Schema.String,
  components: Schema.String,
  primitives: Schema.String,
  routes: Schema.String,
  home: Schema.String,
  locales: Schema.String,
  schemas: Schema.String,
  analytics: Schema.String,
  analyticsEvents: Schema.String,
  appRoot: Schema.String,
  hooks: Schema.String,
  routeTable: Schema.String,
  trpc: Schema.String,
  repositories: Schema.String,
});

const SharedFileSchema = Schema.Struct({ path: Schema.String, owner: Schema.String });

const ShipSchema = Schema.Struct({ sharedFiles: Schema.Array(SharedFileSchema) });

const PrimitiveLaneSchema = Schema.Struct({
  name: Schema.String,
  motion: Schema.Boolean,
  files: Schema.Array(Schema.String),
});

const LaneSchema = Schema.Struct({
  name: Schema.String,
  motion: Schema.Boolean,
  owns: Schema.Array(Schema.String),
});

const BrandInitSchema = Schema.Struct({
  contractFence: Schema.Array(Schema.String),
  primitiveLanes: Schema.Array(PrimitiveLaneSchema),
  sharedLanes: Schema.Array(LaneSchema),
  homeLane: LaneSchema,
});

const ConfigFileSchema = Schema.Struct({
  version: Schema.optional(Schema.Literal(CONFIG_VERSION)),
  baseBranch: Schema.optional(Schema.NullOr(Schema.String)),
  coauthor: Schema.optional(Schema.String),
  scratchDirs: Schema.optional(Schema.Array(Schema.String)),
  gates: Schema.optional(Schema.Array(GateSchema)),
  tracker: Schema.optional(Schema.partial(TrackerSchema)),
  reviewBot: Schema.optional(Schema.partial(ReviewBotSchema)),
  docs: Schema.optional(Schema.partial(DocsSchema)),
  loginForm: Schema.optional(Schema.partial(LoginFormSchema)),
  seedLogins: Schema.optional(Schema.Record({ key: Schema.String, value: SeedLoginSchema })),
  paths: Schema.optional(Schema.partial(PathsSchema)),
  ship: Schema.optional(Schema.partial(ShipSchema)),
  brandInit: Schema.optional(Schema.partial(BrandInitSchema)),
});

export type Gate = typeof GateSchema.Type;
export type ReviewBot = typeof ReviewBotSchema.Type;
export type LoginForm = typeof LoginFormSchema.Type;
export type SeedLogin = typeof SeedLoginSchema.Type;
export type Paths = Partial<typeof PathsSchema.Type>;

export interface HarnessConfig {
  version: typeof CONFIG_VERSION;
  baseBranch: string | null;
  coauthor: string;
  scratchDirs: string[];
  gates: Gate[];
  tracker: typeof TrackerSchema.Type;
  reviewBot: ReviewBot;
  docs: typeof DocsSchema.Type;
  loginForm: LoginForm;
  seedLogins: Record<string, SeedLogin>;
  paths: Paths;
  ship: Partial<typeof ShipSchema.Type>;
  brandInit: Partial<typeof BrandInitSchema.Type>;
}

export const CONFIG_KEYS = Object.keys(ConfigFileSchema.fields);
export const NESTED_KEYS = {
  tracker: Object.keys(TrackerSchema.fields),
  reviewBot: Object.keys(ReviewBotSchema.fields),
  docs: Object.keys(DocsSchema.fields),
  loginForm: Object.keys(LoginFormSchema.fields),
  paths: Object.keys(PathsSchema.fields),
  ship: Object.keys(ShipSchema.fields),
  sharedFile: Object.keys(SharedFileSchema.fields),
  brandInit: Object.keys(BrandInitSchema.fields),
  primitiveLane: Object.keys(PrimitiveLaneSchema.fields),
  lane: Object.keys(LaneSchema.fields),
  gates: Object.keys(GateSchema.fields),
};

export const HARNESS_DEFAULTS: HarnessConfig = {
  version: CONFIG_VERSION,
  baseBranch: null,
  coauthor: DEFAULT_COAUTHOR,
  scratchDirs: [...DEFAULT_SCRATCH_DIRS],
  gates: [],
  tracker: { readyLabel: DEFAULT_READY_LABEL },
  reviewBot: { ...DEFAULT_REVIEW_BOT },
  docs: { ...DEFAULT_DOCS },
  loginForm: { ...DEFAULT_LOGIN_FORM },
  seedLogins: {},
  paths: {},
  ship: {},
  brandInit: {},
};

export interface LoadDeps {
  root: string;
  readFile: (path: string) => string | null;
}

const RawJson = Schema.parseJson(Schema.Unknown);
const decodeFile = Schema.decodeUnknownEither(ConfigFileSchema, { onExcessProperty: "error", errors: "first" });

const firstIssue = (error: ParseResult.ParseError): string => {
  const issue = ParseResult.ArrayFormatter.formatErrorSync(error)[0];
  if (issue === undefined) return CONFIG_FILE_NAME;
  const key = issue.path.map(String).join(KEY_SEPARATOR);
  return key === "" ? `${CONFIG_FILE_NAME}: ${issue.message}` : `${key}: ${issue.message}`;
};

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const body = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(Reflect.get(value, key))}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const configChecksum = (config: HarnessConfig): string => ledgerChecksum(stableJson(config));

function fillDefaults(file: typeof ConfigFileSchema.Type): HarnessConfig {
  return {
    version: CONFIG_VERSION,
    baseBranch: file.baseBranch ?? HARNESS_DEFAULTS.baseBranch,
    coauthor: file.coauthor ?? HARNESS_DEFAULTS.coauthor,
    scratchDirs: [...(file.scratchDirs ?? HARNESS_DEFAULTS.scratchDirs)],
    gates: [...(file.gates ?? HARNESS_DEFAULTS.gates)],
    tracker: { ...HARNESS_DEFAULTS.tracker, ...file.tracker },
    reviewBot: { ...HARNESS_DEFAULTS.reviewBot, ...file.reviewBot },
    docs: { ...HARNESS_DEFAULTS.docs, ...file.docs },
    loginForm: { ...HARNESS_DEFAULTS.loginForm, ...file.loginForm },
    seedLogins: { ...(file.seedLogins ?? HARNESS_DEFAULTS.seedLogins) },
    paths: { ...file.paths },
    ship: { ...file.ship },
    brandInit: { ...file.brandInit },
  };
}

export function loadHarnessConfig(deps: LoadDeps): Either.Either<HarnessConfig, string> {
  const text = deps.readFile(join(deps.root, CONFIG_FILE_NAME));
  if (text === null) return Either.right(HARNESS_DEFAULTS);
  const raw = Schema.decodeUnknownEither(RawJson)(text);
  if (Either.isLeft(raw)) return Either.left(`${MESSAGE_PREFIX} ${BAD_JSON_LINE}`);
  const decoded = decodeFile(raw.right);
  if (Either.isLeft(decoded)) return Either.left(`${MESSAGE_PREFIX} ${firstIssue(decoded.left)}`);
  return Either.right(fillDefaults(decoded.right));
}

export const HARNESS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readDiskFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === NOT_FOUND_CODE) return null;
    throw error;
  }
}

export function loadHarnessConfigFromDisk(root: string = HARNESS_ROOT): HarnessConfig {
  const loaded = loadHarnessConfig({ root, readFile: readDiskFile });
  if (Either.isLeft(loaded)) throw new Error(loaded.left);
  return loaded.right;
}
