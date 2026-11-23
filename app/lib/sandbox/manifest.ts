import {
  SANDBOX_MANIFEST_VERSION,
  SANDBOX_PAGE_PATH,
  SANDBOX_QUERY,
} from "@/lib/constants/sandbox";
import type { Scenario, ScenarioName } from "@/lib/fixtures/schema";
import { caseKey, type SandboxModuleId, type SandboxModuleMeta } from "./modules";

export interface SandboxManifestCase {
  readonly id: string;
  readonly label: string;
  readonly scenarios: ReadonlyArray<ScenarioName>;
  readonly caseKeys: ReadonlyArray<string>;
  readonly urls: ReadonlyArray<string>;
}

export interface SandboxManifestModule {
  readonly id: SandboxModuleId;
  readonly title: string;
  readonly description: string;
  readonly needsRole?: "admin";
  readonly cases: ReadonlyArray<SandboxManifestCase>;
}

export interface SandboxManifestScenario {
  readonly name: ScenarioName;
  readonly description: string;
  readonly users: number;
}

export interface SandboxManifest {
  readonly version: typeof SANDBOX_MANIFEST_VERSION;
  readonly scenarios: ReadonlyArray<SandboxManifestScenario>;
  readonly modules: ReadonlyArray<SandboxManifestModule>;
}

export const caseUrl = (
  moduleId: SandboxModuleId,
  caseId: string,
  scenario: ScenarioName,
): string =>
  `${SANDBOX_PAGE_PATH}?${new URLSearchParams({
    [SANDBOX_QUERY.module]: moduleId,
    [SANDBOX_QUERY.case]: caseId,
    [SANDBOX_QUERY.scenario]: scenario,
  })}`;

const manifestModule = (module: SandboxModuleMeta): SandboxManifestModule => ({
  id: module.id,
  title: module.title,
  description: module.description,
  ...(module.needsRole ? { needsRole: module.needsRole } : {}),
  cases: module.cases.map((entry) => ({
    id: entry.id,
    label: entry.label,
    scenarios: entry.scenarios,
    caseKeys: entry.scenarios.map((scenario) => caseKey(module.id, entry.id, scenario)),
    urls: entry.scenarios.map((scenario) => caseUrl(module.id, entry.id, scenario)),
  })),
});

export const buildManifest = (
  modules: ReadonlyArray<SandboxModuleMeta>,
  scenarios: ReadonlyArray<Scenario>,
): SandboxManifest => ({
  version: SANDBOX_MANIFEST_VERSION,
  scenarios: scenarios.map((scenario) => ({
    name: scenario.name,
    description: scenario.description,
    users: scenario.users.length,
  })),
  modules: modules.map(manifestModule),
});
