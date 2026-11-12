/**
 * Colour scale for the rain field.
 *
 * Rain rate is a continuous magnitude, so the scale is **sequential: one hue, blue,
 * monotonic in lightness** — never a rainbow. The steps are the documented blue ramp.
 *
 * The map canvas is always dark (a rain field only reads against a dark surface, the
 * same reason radar displays are dark), so the ramp is oriented with the *lightest*
 * step at the heaviest rain: intensity reads as brightness against the surface.
 * Opacity rises with rate as a second, redundant channel, which also lets the basemap
 * show through where it is barely raining.
 */

export interface ColorStop {
  /** Rain rate in mm/h at which this colour applies. */
  mmh: number;
  rgb: [number, number, number];
  alpha: number;
}

/** Log-spaced stops. Below `DRY_THRESHOLD_MMH` nothing is drawn at all. */
export const DRY_THRESHOLD_MMH = 0.05;

export const RAIN_STOPS: ColorStop[] = [
  { mmh: 0.05, rgb: [13, 54, 107], alpha: 0.28 }, // blue 700
  { mmh: 0.2, rgb: [24, 79, 149], alpha: 0.46 }, // blue 600
  { mmh: 0.5, rgb: [37, 106, 191], alpha: 0.6 }, // blue 500
  { mmh: 1, rgb: [42, 120, 214], alpha: 0.72 }, // blue 450
  { mmh: 2, rgb: [57, 135, 229], alpha: 0.8 }, // blue 400
  { mmh: 4, rgb: [85, 152, 231], alpha: 0.86 }, // blue 350
  { mmh: 8, rgb: [134, 182, 239], alpha: 0.9 }, // blue 250
  { mmh: 16, rgb: [183, 211, 246], alpha: 0.93 }, // blue 150
  { mmh: 32, rgb: [205, 226, 251], alpha: 0.95 }, // blue 100
  { mmh: 64, rgb: [234, 244, 255], alpha: 0.97 }, // beyond 100
];

/** Legend bands, labelled by the interval they cover. */
export const LEGEND_BANDS = RAIN_STOPS.map((stop, i) => ({
  from: stop.mmh,
  to: RAIN_STOPS[i + 1]?.mmh ?? null,
  css: `rgba(${stop.rgb[0]}, ${stop.rgb[1]}, ${stop.rgb[2]}, ${stop.alpha})`,
}));

const LUT_SIZE = 1024;
const LUT_MAX_MMH = 80;

/**
 * Premultiplied RGBA lookup table, indexed by a log-scaled rate bucket.
 *
 * Built once: colouring a 141x141 frame then costs one table lookup per pixel, which
 * keeps frame changes well inside a single animation frame.
 */
function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(LUT_SIZE * 4);
  for (let k = 0; k < LUT_SIZE; k++) {
    const mmh = bucketToRate(k);
    const [r, g, b, a] = sampleStops(mmh);
    lut[k * 4] = r;
    lut[k * 4 + 1] = g;
    lut[k * 4 + 2] = b;
    lut[k * 4 + 3] = a * 255;
  }
  return lut;
}

/** Map a rate to a LUT bucket on a log scale, so low rates get fine resolution. */
export function rateToBucket(mmh: number): number {
  if (!(mmh > DRY_THRESHOLD_MMH)) return 0;
  const t =
    Math.log(mmh / DRY_THRESHOLD_MMH) / Math.log(LUT_MAX_MMH / DRY_THRESHOLD_MMH);
  const k = Math.round(t * (LUT_SIZE - 1));
  return k < 1 ? 1 : k > LUT_SIZE - 1 ? LUT_SIZE - 1 : k;
}

function bucketToRate(k: number): number {
  if (k === 0) return 0;
  const t = k / (LUT_SIZE - 1);
  return DRY_THRESHOLD_MMH * Math.pow(LUT_MAX_MMH / DRY_THRESHOLD_MMH, t);
}

function sampleStops(mmh: number): [number, number, number, number] {
  if (!(mmh > DRY_THRESHOLD_MMH)) return [0, 0, 0, 0];
  const first = RAIN_STOPS[0]!;
  const last = RAIN_STOPS[RAIN_STOPS.length - 1]!;
  if (mmh <= first.mmh) return [...first.rgb, first.alpha];
  if (mmh >= last.mmh) return [...last.rgb, last.alpha];

  for (let i = 0; i < RAIN_STOPS.length - 1; i++) {
    const a = RAIN_STOPS[i]!;
    const b = RAIN_STOPS[i + 1]!;
    if (mmh <= b.mmh) {
      // Interpolate in log space, matching how the stops were chosen.
      const t = Math.log(mmh / a.mmh) / Math.log(b.mmh / a.mmh);
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t,
        a.alpha + (b.alpha - a.alpha) * t,
      ];
    }
  }
  return [...last.rgb, last.alpha];
}

export const RAIN_LUT = buildLut();

/** CSS colour for a rate, for chart marks and readouts. */
export function rateToCss(mmh: number): string {
  const [r, g, b, a] = sampleStops(mmh);
  if (a === 0) return "transparent";
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(2)})`;
}
