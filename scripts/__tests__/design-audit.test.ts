import { describe, it, expect } from "vitest";
import {
  parseColour,
  composite,
  resolveBackground,
  contrastRatio,
  luminance,
  type Rgba,
} from "../lib/colour";

const WHITE: Rgba = [255, 255, 255, 1];
const BLACK: Rgba = [0, 0, 0, 1];

describe("parseColour", () => {
  it("reads alpha from rgba(): a translucent colour must not come back opaque", () => {
    expect(parseColour("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
    expect(parseColour("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
  });

  it("reads space syntax with slash alpha, including percentages", () => {
    expect(parseColour("rgb(10 20 30 / 0.25)")).toEqual([10, 20, 30, 0.25]);
    expect(parseColour("rgb(10 20 30 / 50%)")).toEqual([10, 20, 30, 0.5]);
  });

  it("treats 'transparent' as alpha 0, not black", () => {
    expect(parseColour("transparent")).toEqual([0, 0, 0, 0]);
  });

  it("parses color(srgb …) with alpha, which Chrome returns for computed oklch fallbacks", () => {
    expect(parseColour("color(srgb 1 0 0 / 0.5)")).toEqual([255, 0, 0, 0.5]);
  });

  it("parses oklch: white, black, and a saturated red land on the right sRGB values", () => {
    expect(parseColour("oklch(1 0 0)")).toEqual([255, 255, 255, 1]);
    expect(parseColour("oklch(0 0 0)")).toEqual([0, 0, 0, 1]);
    const red = parseColour("oklch(0.628 0.2577 29.23)")!;
    expect(red[0]).toBeGreaterThan(250);
    expect(red[1]).toBeLessThan(5);
    expect(red[2]).toBeLessThan(5);
  });

  it("parses oklch with percentage lightness and slash alpha", () => {
    expect(parseColour("oklch(100% 0 0 / 0.4)")).toEqual([255, 255, 255, 0.4]);
  });

  it("parses hex, including 8-digit alpha", () => {
    expect(parseColour("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColour("#00000080")![3]).toBeCloseTo(0.5, 1);
  });

  it("returns null for formats it cannot read so the canvas fallback runs", () => {
    expect(parseColour("color-mix(in oklab, red, blue)")).toBeNull();
    expect(parseColour("lab(50 40 30)")).toBeNull();
  });
});

describe("composite", () => {
  it("a fully transparent background over white stays white, not black", () => {
    expect(composite([0, 0, 0, 0], WHITE)).toEqual([255, 255, 255, 1]);
  });

  it("50% black over white is mid grey: the semi-transparent compositing math", () => {
    expect(composite([0, 0, 0, 0.5], WHITE)).toEqual([128, 128, 128, 1]);
  });

  it("an opaque foreground replaces the background", () => {
    expect(composite([10, 20, 30, 1], WHITE)).toEqual([10, 20, 30, 1]);
  });
});

describe("resolveBackground", () => {
  it("a transparent ghost button on a white card resolves to white", () => {
    expect(resolveBackground([[0, 0, 0, 0], WHITE], BLACK)).toEqual(WHITE);
  });

  it("walks up past transparent ancestors to the nearest opaque one", () => {
    const dark: Rgba = [20, 20, 20, 1];
    expect(resolveBackground([[0, 0, 0, 0], [0, 0, 0, 0], dark, WHITE], WHITE)).toEqual(dark);
  });

  it("composites a translucent layer over the opaque ancestor beneath it", () => {
    expect(resolveBackground([[0, 0, 0, 0.5], WHITE], BLACK)).toEqual([128, 128, 128, 1]);
  });

  it("uses the fallback when every layer is transparent", () => {
    expect(resolveBackground([[0, 0, 0, 0]], WHITE)).toEqual(WHITE);
  });
});

describe("contrastRatio", () => {
  it("black on white is 21:1", () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
  });

  it("dark text on a transparent-over-white button is high contrast, not the 1.79:1 black-background bug", () => {
    const bg = resolveBackground([[0, 0, 0, 0], WHITE], WHITE);
    expect(contrastRatio([23, 23, 23, 1], bg)).toBeGreaterThan(15);
  });

  it("is symmetric in which colour is lighter", () => {
    expect(contrastRatio(WHITE, BLACK)).toBe(21);
  });

  it("a translucent foreground is painted over the background before measuring", () => {
    expect(contrastRatio([0, 0, 0, 0.5], WHITE)).toBeCloseTo(3.95, 1);
  });

  it("luminance of white is 1 and of black is 0", () => {
    expect(luminance(WHITE)).toBeCloseTo(1, 5);
    expect(luminance(BLACK)).toBe(0);
  });
});
