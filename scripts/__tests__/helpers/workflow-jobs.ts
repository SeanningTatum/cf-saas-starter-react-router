import { expect } from "vitest";

export interface Job {
  id: string;
  name: string;
  condition: string | undefined;
  needs: string[];
  body: string;
}

export type Context = Record<string, unknown>;

const JOB_KEY = /^ {2}([\w-]+):\s*$/;
const TOKEN = /\s*(\|\||&&|==|!=|\(|\)|'[^']*'|[\w.-]+)/y;

const field = (lines: string[], key: string): string | undefined =>
  lines.map((line) => line.match(new RegExp(`^ {4}${key}:\\s*(.*)$`))?.[1]).find((value) => value !== undefined);

const listOf = (value: string | undefined): string[] =>
  value === undefined
    ? []
    : value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

export function jobsOf(text: string): Job[] {
  const lines = text.split("\n").filter((line) => !/^\s*#/.test(line));
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const jobs: { id: string; lines: string[] }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const key = line.match(JOB_KEY);
    if (key?.[1]) jobs.push({ id: key[1], lines: [] });
    else jobs.at(-1)?.lines.push(line);
  }
  return jobs.map(({ id, lines: body }) => ({
    id,
    name: field(body, "name") ?? id,
    condition: field(body, "if"),
    needs: listOf(field(body, "needs")),
    body: body.join("\n"),
  }));
}

function tokens(expression: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < expression.trimEnd().length) {
    const match = TOKEN.exec(expression);
    if (!match?.[1]) return expect.unreachable(`cannot read the expression at: ${expression.slice(TOKEN.lastIndex)}`);
    out.push(match[1]);
  }
  return out;
}

const lookup = (context: Context, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => (value !== null && typeof value === "object" ? (value as Context)[key] : undefined), context);

export function evaluate(expression: string, context: Context): boolean {
  const queue = tokens(expression);
  const take = (): string => queue.shift() ?? "";
  const primary = (): unknown => {
    const token = take();
    if (token === "(") {
      const value = or();
      take();
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1);
    if (token === "true" || token === "false") return token === "true";
    if ((token === "always" || token === "failure") && queue[0] === "(" && queue[1] === ")") {
      queue.splice(0, 2);
      return token === "always" || context.failure === true;
    }
    return lookup(context, token) ?? "";
  };
  const compare = (): unknown => {
    const left = primary();
    if (queue[0] !== "==" && queue[0] !== "!=") return left;
    const equal = take() === "==";
    return (String(left).toLowerCase() === String(primary()).toLowerCase()) === equal;
  };
  const and = (): unknown => {
    let value = compare();
    while (queue[0] === "&&") {
      take();
      const right = compare();
      value = Boolean(value) && Boolean(right);
    }
    return value;
  };
  const or = (): unknown => {
    let value = and();
    while (queue[0] === "||") {
      take();
      const right = and();
      value = Boolean(value) || Boolean(right);
    }
    return value;
  };
  return Boolean(or());
}

export function jobsThatRun(jobs: Job[], context: Context): string[] {
  const runs = new Map<string, boolean>();
  const decide = (job: Job): boolean => {
    const known = runs.get(job.id);
    if (known !== undefined) return known;
    const runsAnyway = /^\s*(always|failure)\(\)/.test(job.condition ?? "");
    const parents =
      runsAnyway ||
      job.needs.every((id) => {
        const parent = jobs.find((other) => other.id === id);
        return parent !== undefined && decide(parent);
      });
    const value = parents && (job.condition === undefined || evaluate(job.condition, context));
    runs.set(job.id, value);
    return value;
  };
  return jobs.filter(decide).map((job) => job.id);
}
