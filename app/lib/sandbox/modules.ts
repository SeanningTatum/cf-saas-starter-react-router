import { Schema } from "effect";
import {
  SANDBOX_CASE_KEY_SEPARATOR,
  SANDBOX_MODULE_IDS,
  SANDBOX_MODULE_TABLE,
} from "@/lib/constants/sandbox";
import type { ScenarioName } from "@/lib/fixtures/schema";

export const SandboxModuleId = Schema.Literal(...SANDBOX_MODULE_IDS);
export type SandboxModuleId = typeof SandboxModuleId.Type;

export interface SandboxCaseMeta {
  readonly id: string;
  readonly label: string;
  readonly scenarios: ReadonlyArray<ScenarioName>;
}

export interface SandboxModuleMeta {
  readonly id: SandboxModuleId;
  readonly title: string;
  readonly description: string;
  readonly needsRole?: "admin";
  readonly cases: ReadonlyArray<SandboxCaseMeta>;
}

export const SANDBOX_MODULES: ReadonlyArray<SandboxModuleMeta> = SANDBOX_MODULE_TABLE;

export const caseKey = (
  moduleId: SandboxModuleId,
  caseId: string,
  scenario: ScenarioName,
): string => [moduleId, caseId, scenario].join(SANDBOX_CASE_KEY_SEPARATOR);
