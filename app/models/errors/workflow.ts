import { Data } from "effect";

export class WorkflowTriggerError extends Data.TaggedError(
  "WorkflowTriggerError"
)<{
  readonly name: string;
  readonly cause?: unknown;
}> {}

export type WorkflowError = WorkflowTriggerError;
