import { allResolved, isResolved, type SetupRequest } from "./setup-args";
import {
  ALL_ENVIRONMENTS_QUESTION,
  AUTO_GENERATED_ENVIRONMENTS,
  GROUP_QUESTIONS,
  MAX_ATTEMPTS,
  PRODUCTION_ENVIRONMENT,
  READINESS_QUESTION,
  type SetupEnvironment,
} from "./setup-constants";
import { flagOf, GROUP_NAMES, itemById, SETUP_ITEMS, type SetupItem } from "./setup-items";
import { isSet, type Snapshot } from "./setup-readiness";
import { checkValue, TURNSTILE_PAIR_PROBLEM } from "./setup-validate";

export interface Ask {
  readonly text: (label: string) => Promise<string | undefined>;
  readonly secret: (label: string) => Promise<string | undefined>;
  readonly confirm: (label: string, initial: boolean) => Promise<boolean>;
  readonly say: (line: string) => void;
}

export type Source = "flag" | "prompt" | "generated" | "detected";

export interface Entry {
  readonly item: SetupItem;
  readonly value: string;
  readonly source: Source;
}

export interface Plan {
  readonly entries: ReadonlyArray<Entry>;
  readonly kept: ReadonlyArray<SetupItem>;
  readonly problems: ReadonlyArray<string>;
}

export interface PlanInput {
  readonly request: SetupRequest;
  readonly snapshot: Snapshot;
  readonly ask: Ask | undefined;
  readonly generateSecret: () => string;
  readonly detectedAccountId: string | undefined;
}

const alreadySet = (item: SetupItem, snapshot: Snapshot): boolean => isSet(item, snapshot) === true;

const generates = (item: SetupItem, request: SetupRequest, snapshot: Snapshot): boolean =>
  item.generated === true &&
  AUTO_GENERATED_ENVIRONMENTS.includes(item.environment) &&
  !request.skips.has(item.id) &&
  (request.rotateAuthSecret || isSet(item, snapshot) === false);

const askFor = async (item: SetupItem, ask: Ask): Promise<string | undefined> => {
  const label = `${item.label} (${item.environment})${item.link ? `, made at ${item.link}` : ""}, blank to skip`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const answer = (item.secret ? await ask.secret(label) : await ask.text(label))?.trim();
    if (answer === undefined || answer === "") return undefined;
    const problem = checkValue(item.check, answer);
    if (problem === undefined) return answer;
    ask.say(`${item.label}: ${problem}`);
  }
  return undefined;
};

const scopeOf = async (ask: Ask): Promise<ReadonlyArray<SetupEnvironment>> =>
  (await ask.confirm(ALL_ENVIRONMENTS_QUESTION, false)) ? ["production", "preview", "staging"] : [PRODUCTION_ENVIRONMENT];

const promptable = (item: SetupItem, request: SetupRequest, snapshot: Snapshot, scope: ReadonlyArray<SetupEnvironment>): boolean =>
  !item.generated && scope.includes(item.environment) && !isResolved(request, item) && !alreadySet(item, snapshot);

const prompted = async (input: PlanInput, ask: Ask): Promise<ReadonlyArray<Entry>> => {
  if (!(await ask.confirm(READINESS_QUESTION, true))) return [];
  const scope = await scopeOf(ask);
  const entries: Entry[] = [];
  for (const group of GROUP_NAMES) {
    const items = SETUP_ITEMS.filter((item) => item.group === group && promptable(item, input.request, input.snapshot, scope));
    if (items.length === 0 || !(await ask.confirm(GROUP_QUESTIONS[group] ?? `Set ${group} now?`, true))) continue;
    for (const item of items) {
      const value = await askFor(item, ask);
      if (value !== undefined) entries.push({ item, value, source: "prompt" });
    }
  }
  return entries;
};

const fromRequest = (input: PlanInput): ReadonlyArray<Entry> => {
  const { request, snapshot } = input;
  const entries: Entry[] = [];
  for (const item of SETUP_ITEMS) {
    const given = request.values.get(item.id);
    if (given !== undefined) entries.push({ item, value: given, source: "flag" });
    else if (generates(item, request, snapshot)) entries.push({ item, value: input.generateSecret(), source: "generated" });
    else if (item.id === "account-id" && input.detectedAccountId && !request.skips.has(item.id) && !alreadySet(item, snapshot))
      entries.push({ item, value: input.detectedAccountId, source: "detected" });
  }
  return entries;
};

const presentAfter = (item: SetupItem, entries: ReadonlyArray<Entry>, snapshot: Snapshot): boolean =>
  entries.some((entry) => entry.item.id === item.id) || alreadySet(item, snapshot);

const pairProblems = (entries: ReadonlyArray<Entry>, snapshot: Snapshot): { dropped: ReadonlySet<string>; problems: ReadonlyArray<string> } => {
  const dropped = new Set<string>();
  const problems: string[] = [];
  for (const entry of entries) {
    const partner = entry.item.pairWith === undefined ? undefined : itemById(entry.item.pairWith);
    if (partner === undefined || dropped.has(entry.item.id)) continue;
    const bothThere = presentAfter(entry.item, entries, snapshot) && presentAfter(partner, entries, snapshot);
    if (bothThere) continue;
    dropped.add(entry.item.id);
    problems.push(`${flagOf(entry.item)}: ${TURNSTILE_PAIR_PROBLEM}; add ${flagOf(partner)} in the same run`);
  }
  return { dropped, problems };
};

export const buildPlan = async (input: PlanInput): Promise<Plan> => {
  const interactive = input.ask !== undefined && !input.request.yes && !allResolved(input.request);
  const asked = interactive && input.ask ? await prompted(input, input.ask) : [];
  const gathered = [...fromRequest(input), ...asked];
  const { dropped, problems } = pairProblems(gathered, input.snapshot);
  const entries = gathered.filter((entry) => !dropped.has(entry.item.id));
  const kept = SETUP_ITEMS.filter((item) => alreadySet(item, input.snapshot) && !entries.some((entry) => entry.item.id === item.id));
  return { entries, kept, problems };
};
