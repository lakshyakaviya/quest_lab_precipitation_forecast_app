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

/*
 * The ramp starts at blue 550 rather than 700. The darkest steps were very close in
 * lightness to the sea behind them, so drizzle was effectively invisible over water —
 * the most common case in a monsoon forecast. Starting mid-ramp costs a little
 * dynamic range at the dry end and buys a visible floor; lightness is still monotonic
 * across the whole scale, and the sea is now a neutral grey so hue separates it too.
 */
export const RAIN_STOPS: ColorStop[] = [
  { mmh: 0.05, rgb: [28, 92, 171], alpha: 0.5 }, // blue 550
  { mmh: 0.2, rgb: [37, 106, 191], alpha: 0.62 }, // blue 500
  { mmh: 0.5, rgb: [42, 120, 214], alpha: 0.72 }, // blue 450
  { mmh: 1, rgb: [57, 135, 229], alpha: 0.79 }, // blue 400
  { mmh: 2, rgb: [85, 152, 231], alpha: 0.85 }, // blue 350
  { mmh: 4, rgb: [109, 167, 236], alpha: 0.88 }, // blue 300
  { mmh: 8, rgb: [134, 182, 239], alpha: 0.91 }, // blue 250
  { mmh: 16, rgb: [158, 197, 244], alpha: 0.93 }, // blue 200
  { mmh: 32, rgb: [205, 226, 251], alpha: 0.96 }, // blue 100
  { mmh: 64, rgb: [234, 244, 255], alpha: 0.98 }, // beyond 100
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

// --------------------------------------------------------------------------------------
// Model disagreement
// --------------------------------------------------------------------------------------

/**
 * Diverging scale for "physics minus AI" rain rate.
 *
 * Two hues with a **neutral midpoint**: blue where IFS is wetter, orange where AIFS is
 * wetter, and nothing at all where they agree. A neutral centre is what makes "no
 * disagreement" read as no signal; a hue there would invent one. Neither colour means
 * "right" — the scale shows where the two forecasts part company, not which to believe.
 */
export const DELTA_COLORS = {
  physicsWetter: [57, 135, 229] as [number, number, number], // blue 400
  aiWetter: [217, 89, 38] as [number, number, number], // orange, dark step
};

/** Below this the models are treated as agreeing and nothing is drawn. */
export const DELTA_DEADBAND_MMH = 0.05;
/** Rate difference that saturates the scale. */
export const DELTA_MAX_MMH = 4;

// Must be ODD so the table has an exact centre cell. With an even size the midpoint
// lands on a half index, `deltaBucketToDiff` never returns exactly zero, and the
// "models agree" deadband never renders transparent — which painted the entire domain.
const DELTA_LUT_SIZE = 513;

function deltaSample(diff: number): [number, number, number, number] {
  const mag = Math.abs(diff);
  if (mag <= DELTA_DEADBAND_MMH) return [0, 0, 0, 0];
  const t = Math.min(
    1,
    Math.log(mag / DELTA_DEADBAND_MMH) /
      Math.log(DELTA_MAX_MMH / DELTA_DEADBAND_MMH),
  );
  const [r, g, b] = diff > 0 ? DELTA_COLORS.physicsWetter : DELTA_COLORS.aiWetter;
  return [r, g, b, 0.25 + 0.7 * t];
}

function buildDeltaLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(DELTA_LUT_SIZE * 4);
  for (let k = 0; k < DELTA_LUT_SIZE; k++) {
    const [r, g, b, a] = deltaSample(deltaBucketToDiff(k));
    lut[k * 4] = r;
    lut[k * 4 + 1] = g;
    lut[k * 4 + 2] = b;
    lut[k * 4 + 3] = a * 255;
  }
  return lut;
}

/** Signed log bucket: the middle of the table is zero difference. */
export function deltaToBucket(diff: number): number {
  const half = (DELTA_LUT_SIZE - 1) / 2;
  const mag = Math.abs(diff);
  if (mag <= DELTA_DEADBAND_MMH) return Math.round(half);
  const t = Math.min(
    1,
    Math.log(mag / DELTA_DEADBAND_MMH) /
      Math.log(DELTA_MAX_MMH / DELTA_DEADBAND_MMH),
  );
  const offset = Math.round(t * half);
  return diff > 0 ? Math.round(half) + offset : Math.round(half) - offset;
}

function deltaBucketToDiff(k: number): number {
  const half = (DELTA_LUT_SIZE - 1) / 2;
  const offset = k - half;
  if (offset === 0) return 0;
  const t = Math.abs(offset) / half;
  const mag =
    DELTA_DEADBAND_MMH * Math.pow(DELTA_MAX_MMH / DELTA_DEADBAND_MMH, t);
  return offset > 0 ? mag : -mag;
}

export const DELTA_LUT = buildDeltaLut();

/** Legend swatches for the disagreement scale, driest-disagreement in the middle. */
export const DELTA_BANDS = [
  { label: "4", diff: -4 },
  { label: "1", diff: -1 },
  { label: "0.2", diff: -0.2 },
  { label: "agree", diff: 0 },
  { label: "0.2", diff: 0.2 },
  { label: "1", diff: 1 },
  { label: "4", diff: 4 },
].map((b) => {
  const [r, g, bl, a] = deltaSample(b.diff);
  return {
    label: b.label,
    css: a === 0 ? "rgba(137,135,129,0.22)" : `rgba(${r}, ${g}, ${bl}, ${a})`,
  };
});
