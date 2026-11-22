export type Fields = Readonly<Record<string, unknown>>;

export const clip = (text: string, max: number): string => text.slice(0, max);

export const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null;
