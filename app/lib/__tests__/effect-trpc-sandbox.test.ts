import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { tagToTRPC } from "../effect-trpc";
import {
  SandboxCaseNotDeclaredError,
  SandboxDisabledError,
  SandboxUnknownModuleError,
  SandboxUnknownScenarioError,
} from "@/models/errors/sandbox";

describe("tagToTRPC sandbox errors", () => {
  it.effect.each([
    new SandboxDisabledError({ reason: "flag-off" }),
    new SandboxUnknownModuleError({ moduleId: "users-tabel", valid: ["users-table"] }),
    new SandboxUnknownScenarioError({ scenario: "huge", valid: ["base"] }),
    new SandboxCaseNotDeclaredError({
      moduleId: "file-upload",
      caseId: "busy",
      validCases: ["idle"],
      validScenarios: ["base"],
    }),
  ])("$_tag → NOT_FOUND with a plain message that names no module, case or flag", (error) =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(tagToTRPC(Effect.fail(error)));
      const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
      expect(Option.map(failure, (e) => e.code)).toEqual(Option.some("NOT_FOUND"));
      expect(Option.map(failure, (e) => e.message)).toEqual(Option.some("Not Found"));
    }),
  );
});
