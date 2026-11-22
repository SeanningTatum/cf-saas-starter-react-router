import { describe, expect, it } from "vitest";
import {
  BAD_JSON_LINE,
  CONFIG_FILE_NAME,
  DEFAULT_COAUTHOR,
  DEFAULT_DOCS,
  DEFAULT_LOGIN_FORM,
  DEFAULT_REVIEW_BOT,
  GATE_FORBIDDEN_CHARACTERS,
  MISSING_GATES_LINE,
} from "../harness-config-constants";

describe("harness-config-constants", () => {
  it("names the file and the two lines callers print: the docs and the scripts quote them", () => {
    expect(CONFIG_FILE_NAME).toBe("harness.config.json");
    expect(MISSING_GATES_LINE).toBe("set gates in harness.config.json");
    expect(BAD_JSON_LINE).toBe("harness.config.json is not valid JSON");
  });

  it("forbids a pipe and a line break in a gate field: verify.sh splits its lines on the pipe", () => {
    expect(GATE_FORBIDDEN_CHARACTERS.test("a|b")).toBe(true);
    expect(GATE_FORBIDDEN_CHARACTERS.test("a\nb")).toBe(true);
    expect(GATE_FORBIDDEN_CHARACTERS.test("bun run test")).toBe(false);
  });

  it("holds generic defaults: no path under the app folder, and the trigger the bot answers to", () => {
    expect(JSON.stringify([DEFAULT_DOCS, DEFAULT_LOGIN_FORM, DEFAULT_REVIEW_BOT])).not.toMatch(/(^|[^A-Za-z0-9_./-])ap{2}\//);
    expect(DEFAULT_REVIEW_BOT.trigger).toBe("@greptileai review");
    expect(DEFAULT_COAUTHOR).toMatch(/^Co-Authored-By: .+ <.+@.+>$/);
  });
});
