import { describe, expect, it } from "vitest";
import { Cause, FiberId } from "effect";
import { TRPCError } from "@trpc/server";
import { classifyError } from "../classify";
import { QueryError } from "@/models/errors/repository";

const queryError = () =>
  new QueryError({ entity: "user", cause: new Error("D1 timed out") });

describe("classifyError, plain values", () => {
  it("treats a raw Error as a defect with its stack, so a crash is never filed as expected", () => {
    const error = new TypeError("x is undefined");

    expect(classifyError(error)).toEqual({
      kind: "defect",
      level: "error",
      name: "TypeError",
      message: "x is undefined",
      stack: error.stack,
    });
  });

  it("gives a thrown string or plain object a readable message, so the report is not [object Object]", () => {
    expect(classifyError("boom")).toMatchObject({ kind: "defect", message: "boom" });
    expect(classifyError({ code: 7 })).toMatchObject({
      kind: "defect",
      message: '{"code":7}',
    });
  });

  it("does not throw on a circular object, so reporting an error cannot raise a new one", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(classifyError(circular)).toMatchObject({ kind: "defect", level: "error" });
  });
});

describe("classifyError, tagged errors and causes", () => {
  it("files a tagged error as expected with its tag and the cause's message, so the root cause is not lost", () => {
    expect(classifyError(queryError())).toMatchObject({
      kind: "expected",
      level: "error",
      name: "QueryError",
      tag: "QueryError",
      message: expect.stringContaining("D1 timed out"),
    });
  });

  it("treats Cause.die as a defect and Cause.fail of a tagged error as expected, so an Effect exit keeps its meaning", () => {
    expect(classifyError(Cause.die(new Error("bug")))).toMatchObject({
      kind: "defect",
      message: "bug",
    });
    expect(classifyError(Cause.fail(queryError()))).toMatchObject({
      kind: "expected",
      tag: "QueryError",
    });
  });

  it("treats an interrupt-only cause as a defect, so a cut-off request is still seen", () => {
    expect(classifyError(Cause.interrupt(FiberId.none))).toMatchObject({
      kind: "defect",
      level: "error",
    });
  });
});

describe("classifyError, tRPC errors", () => {
  it("files a NOT_FOUND TRPCError as an expected warning tagged with its code, so 4xx noise does not page anyone", () => {
    expect(
      classifyError(new TRPCError({ code: "NOT_FOUND", message: "user not found" }))
    ).toMatchObject({
      kind: "expected",
      level: "warning",
      tag: "NOT_FOUND",
      message: "user not found",
    });
  });

  it("treats an INTERNAL_SERVER_ERROR with no cause as a defect, so a bare 500 is never filed as expected", () => {
    expect(
      classifyError(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }))
    ).toMatchObject({ kind: "defect", level: "error" });
  });

  it("classifies a 500 by its tagged cause, so a mapped QueryError stays expected at level error", () => {
    expect(
      classifyError(
        new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: queryError() })
      )
    ).toMatchObject({ kind: "expected", level: "error", tag: "QueryError" });
  });

  it("classifies a 500 by its raw cause with that cause's stack, so the real crash site is reported", () => {
    const raw = new Error("db down");

    expect(
      classifyError(new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: raw }))
    ).toMatchObject({
      kind: "defect",
      level: "error",
      message: "db down",
      stack: raw.stack,
    });
  });
});

describe("classifyError, route error responses", () => {
  it("files a 404 response as an expected warning and a 503 as a defect, so only server failures alert", () => {
    expect(classifyError({ status: 404, statusText: "Not Found" })).toMatchObject({
      kind: "expected",
      level: "warning",
      tag: "404",
    });
    expect(
      classifyError({ status: 503, statusText: "Service Unavailable" })
    ).toMatchObject({ kind: "defect", level: "error", tag: "503" });
  });
});

describe("classifyError, hostile shapes", () => {
  it("stops on a cause chain that loops, so a cyclic error cannot overflow the stack", () => {
    const looped = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "a" });
    Object.defineProperty(looped, "cause", { value: looped });

    expect(classifyError(looped)).toMatchObject({ kind: "defect", level: "error" });
  });

  it("describes an object that neither JSON nor String can print, so the fallback cannot throw", () => {
    const bare: Record<string, unknown> = Object.create(null);
    bare.self = bare;

    expect(classifyError(bare)).toMatchObject({
      kind: "defect",
      message: "[object Object]",
    });
  });
});
