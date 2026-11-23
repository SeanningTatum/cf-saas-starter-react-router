import { Data } from "effect";

export class FixtureValidationError extends Data.TaggedError("FixtureValidationError")<{
  readonly scenario: string;
  readonly fixture?: string;
  readonly message: string;
}> {}

export class SeedError extends Data.TaggedError("SeedError")<{
  readonly scenario: string;
  readonly target: "local" | "preview" | "remote" | "memory";
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DevServerRunningError extends Data.TaggedError("DevServerRunningError")<{
  readonly pids: ReadonlyArray<number>;
  readonly stateDir: string;
}> {}

export type FixtureError = FixtureValidationError | SeedError | DevServerRunningError;
