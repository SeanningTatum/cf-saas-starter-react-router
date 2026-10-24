/**
 * Pure colour maths for scripts/design-audit.ts.
 *
 * design-audit stringifies these functions (`fn.toString()`) and runs them inside the page, so each
 * one must be self-contained: call only the other functions in this file, touch no module scope and
 * no imports.
 */

export type Rgba = [number, number, number, number]; // r, g, b in 0..255; alpha in 0..1

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Read one channel: "50%" scales to `scale`, a bare number is taken as is, "none" is 0. */
export function channel(token: string, scale: number): number {
  const t = token.trim();
  if (t === "none") return 0;
  return t.endsWith("%") ? (parseFloat(t) / 100) * scale : parseFloat(t);
}

export function alphaOf(token: string | undefined): number {
  if (token === undefined || token.trim() === "") return 1;
  const a = channel(token, 1);
  return Number.isNaN(a) ? 1 : clamp(a, 0, 1);
}

export function oklchToRgba(l: number, c: number, hDeg: number, alpha: number): Rgba {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m_ = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s_ = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const enc = lin.map((v) => {
    const x = clamp(v, 0, 1);
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
  });
  return [enc[0], enc[1], enc[2], alpha];
}

/**
 * Parse rgb()/rgba() (comma or space syntax, "/ alpha"), color(srgb …), oklch(…), #hex and
 * "transparent". Returns null for anything else (lab, color-mix …) so the caller can ask the canvas.
 */
export function parseColour(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split("").map((ch) => ch + ch).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }

  const fn = /^(rgba?|oklch|color)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const [body, alphaPart] = fn[2].split("/");
  const parts = body.replace(/,/g, " ").trim().split(/\s+/);

  if (fn[1] === "rgb" || fn[1] === "rgba") {
    // Legacy comma syntax carries alpha as a fourth value instead of after a slash.
    const alpha = alphaPart !== undefined ? alphaPart : parts[3];
    const rgb = parts.slice(0, 3).map((p) => clamp(Math.round(channel(p, 255)), 0, 255));
    if (rgb.length < 3 || rgb.some(Number.isNaN)) return null;
    return [rgb[0], rgb[1], rgb[2], alphaOf(alpha)];
  }

  if (fn[1] === "color") {
    if (parts[0] !== "srgb") return null;
    const rgb = parts.slice(1, 4).map((p) => clamp(Math.round(channel(p, 1) * 255), 0, 255));
    if (rgb.length < 3 || rgb.some(Number.isNaN)) return null;
    return [rgb[0], rgb[1], rgb[2], alphaOf(alphaPart)];
  }

  // oklch(L C H): L is 0..1 or a percentage, C is 0..0.4 (100% = 0.4), H is degrees.
  const l = channel(parts[0], 1);
  const c = channel(parts[1] ?? "0", 0.4);
  const hue = parseFloat((parts[2] ?? "0").replace("deg", "")) || 0;
  if (Number.isNaN(l) || Number.isNaN(c)) return null;
  return oklchToRgba(l, c, hue, alphaOf(alphaPart));
}

/** Paint `fg` over `bg` (source-over). The result's alpha is 1 whenever `bg` is opaque. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  const outA = a + bg[3] * (1 - a);
  if (outA === 0) return [0, 0, 0, 0];
  const mix = (i: number) => Math.round((fg[i] * a + bg[i] * bg[3] * (1 - a)) / outA);
  return [mix(0), mix(1), mix(2), outA];
}

/**
 * The colour an element's background really shows. `layers` run from the element outward (its own
 * background first, then each ancestor's). Find the nearest opaque layer, or use `fallback`, then
 * paint the translucent layers over it from the outside in.
 */
export function resolveBackground(layers: Rgba[], fallback: Rgba): Rgba {
  let base = fallback;
  let top = layers.length;
  for (let i = 0; i < layers.length; i++) {
    if (layers[i][3] >= 1) {
      base = layers[i];
      top = i;
      break;
    }
  }
  let out = base;
  for (let i = top - 1; i >= 0; i--) out = composite(layers[i], out);
  return out;
}

export function luminance(c: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** WCAG contrast. A translucent `fg` is first painted over `bg`; `bg` must be opaque. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = luminance(composite(fg, bg));
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}
