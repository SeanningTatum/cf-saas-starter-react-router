import { Data } from "effect";

export class SandboxDisabledError extends Data.TaggedError("SandboxDisabledError")<{
  readonly reason: "not-built" | "flag-off";
}> {}

export class SandboxUnknownModuleError extends Data.TaggedError("SandboxUnknownModuleError")<{
  readonly moduleId: string;
  readonly valid: ReadonlyArray<string>;
}> {}

export class SandboxUnknownScenarioError extends Data.TaggedError("SandboxUnknownScenarioError")<{
  readonly scenario: string;
  readonly valid: ReadonlyArray<string>;
}> {}

export class SandboxCaseNotDeclaredError extends Data.TaggedError("SandboxCaseNotDeclaredError")<{
  readonly moduleId: string;
  readonly caseId?: string;
  readonly scenario?: string;
  readonly validCases: ReadonlyArray<string>;
  readonly validScenarios: ReadonlyArray<string>;
}> {}

export type SandboxSelectionError =
  | SandboxUnknownModuleError
  | SandboxUnknownScenarioError
  | SandboxCaseNotDeclaredError;

export type SandboxError = SandboxDisabledError | SandboxSelectionError;
