import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { UploadOptions, ListR2Input } from "../bucket";

const decode = <A, I>(s: Schema.Schema<A, I>) => Schema.decodeUnknownEither(s);

describe("UploadOptions", () => {
  it("decodes an empty payload", () => {
    expect(decode(UploadOptions)({})._tag).toBe("Right");
  });

  it("decodes a full payload", () => {
    expect(
      decode(UploadOptions)({ key: "uploads/a.png", contentType: "image/png" })
        ._tag
    ).toBe("Right");
  });
});

describe("caps, so a dropped or loosened cap cannot pass R2 a key it refuses or a content type of any size (key and prefix share R2Key, so one row): at the cap decodes, one over fails", () => {
  const s = (n: number) => "a".repeat(n);
  const cases: ReadonlyArray<
    [
      string,
      (u: unknown) => { readonly _tag: "Left" | "Right" },
      number,
      (n: number) => unknown,
    ]
  > = [
    ["UploadOptions.key", decode(UploadOptions), 1024, (n) => ({ key: s(n) })],
    [
      "UploadOptions.contentType",
      decode(UploadOptions),
      255,
      (n) => ({ contentType: s(n) }),
    ],
  ];
  for (const [name, check, cap, build] of cases) {
    it(`${name}: ${cap} decodes, ${cap + 1} fails`, () => {
      expect(check(build(cap))._tag).toBe("Right");
      expect(check(build(cap + 1))._tag).toBe("Left");
    });
  }
});

describe("ListR2Input", () => {
  it("defaults limit to 1000", () => {
    const result = Schema.decodeUnknownSync(ListR2Input)({});
    expect(result.limit).toBe(1000);
  });

  it("accepts a prefix with an explicit limit", () => {
    expect(
      decode(ListR2Input)({ prefix: "uploads/", limit: 50 })._tag
    ).toBe("Right");
  });

  it("rejects limit below 1", () => {
    expect(decode(ListR2Input)({ limit: 0 })._tag).toBe("Left");
  });

  it("rejects limit above 1000", () => {
    expect(decode(ListR2Input)({ limit: 1001 })._tag).toBe("Left");
  });

  it("accepts the boundary values 1 and 1000", () => {
    expect(decode(ListR2Input)({ limit: 1 })._tag).toBe("Right");
    expect(decode(ListR2Input)({ limit: 1000 })._tag).toBe("Right");
  });
});
