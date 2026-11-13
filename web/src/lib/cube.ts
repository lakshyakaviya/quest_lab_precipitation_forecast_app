/**
 * Loads and queries the forecast cube.
 *
 * The whole India forecast is ~2.5 MB of float16 (about 350 KB over the wire, gzipped),
 * so it is fetched once and held in memory. That is why clicking a point is an array
 * lookup rather than a network round trip, and why the app needs no backend at all.
 */

import type { CubeMeta, DataIndex } from "./types";
import { DRY_THRESHOLD_MMH, RAIN_LUT, rateToBucket } from "./colormap";

/** uint16 -> float lookup, so decoding the cube is one pass with no bit twiddling. */
function buildHalfTable(): Float32Array {
  const table = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h & 0x7c00) >> 10;
    const frac = h & 0x03ff;
    if (exp === 0) {
      table[h] = sign * frac * 2 ** -24; // subnormal
    } else if (exp === 31) {
      table[h] = frac ? NaN : sign * Infinity;
    } else {
      table[h] = sign * (frac + 1024) * 2 ** (exp - 25);
    }
  }
  return table;
}

let halfTable: Float32Array | null = null;

function decodeHalf(buffer: ArrayBuffer, count: number): Float32Array {
  // Modern engines have a native Float16Array; fall back to a table otherwise.
  const Native = (
    globalThis as unknown as { Float16Array?: new (b: ArrayBuffer) => ArrayLike<number> }
  ).Float16Array;
  if (Native) {
    return Float32Array.from(new Native(buffer) as ArrayLike<number>);
  }
  halfTable ??= buildHalfTable();
  const raw = new Uint16Array(buffer);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = halfTable[raw[i]!]!;
  return out;
}

export interface PointSeries {
  /** Grid cell actually sampled, which is the nearest cell centre. */
  lat: number;
  lon: number;
  /** Rain rate per frame, mm/h. */
  rate: Float32Array;
  /** Rain accumulated within each frame's own interval, mm. */
  interval: Float32Array;
  /** Rain accumulated from T+0 to the end of each frame, mm. */
  cumulative: Float32Array;
  /** Total over the whole forecast run, mm. */
  total: number;
  /**
   * The frame forward-looking figures are measured from — normally the frame covering
   * the present moment. The forecast run may be hours old by the time anyone reads it,
   * so "peak" and "rain starts" must ignore intervals that have already elapsed.
   */
  fromFrame: number;
  /** Total still to come, from `fromFrame` to the end of the forecast, mm. */
  remainingTotal: number;
  /** Peak rate from `fromFrame` onward, mm/h. */
  peakRate: number;
  peakFrame: number;
  /** Whether it is already raining in the `fromFrame` interval. */
  rainingNow: boolean;
  /**
   * First frame at or after `fromFrame` whose interval total reaches `onsetMm`,
   * or null if it stays dry for the rest of the forecast.
   */
  onsetFrame: number | null;
}

export class Cube {
  readonly meta: CubeMeta;
  readonly values: Float32Array;
  readonly nFrames: number;
  readonly nLat: number;
  readonly nLon: number;
  /** Interval length in hours for each frame. */
  readonly hours: Float32Array;
  readonly validTimes: Date[];
  /** Lead time in hours at the start and end of each frame's interval. */
  readonly stepStart: Float32Array;
  readonly stepEnd: Float32Array;
  /** Lead time at the end of the forecast, for chart axes. */
  readonly maxLead: number;
  private readonly cellsPerFrame: number;

  constructor(meta: CubeMeta, values: Float32Array) {
    this.meta = meta;
    this.values = values;
    this.nFrames = meta.cube.n_frames;
    this.nLat = meta.grid.nlat;
    this.nLon = meta.grid.nlon;
    this.cellsPerFrame = this.nLat * this.nLon;
    this.hours = new Float32Array(meta.frames.map((f) => f.hours));
    this.validTimes = meta.frames.map((f) => new Date(f.valid_time));
    this.stepStart = new Float32Array(meta.frames.map((f) => f.step_start));
    this.stepEnd = new Float32Array(meta.frames.map((f) => f.step_end));
    this.maxLead = this.stepEnd[this.nFrames - 1] ?? 0;
  }

  get runTime(): Date {
    return new Date(this.meta.run.datetime);
  }

  /** Lead time in hours of an instant, relative to the forecast run. */
  leadHoursAt(when: Date): number {
    return (when.getTime() - this.runTime.getTime()) / 3_600_000;
  }

  /**
   * The frame whose valid time is closest to `when` — the single "now" reference.
   *
   * A run is published 7-9 hours after its nominal time and stays the newest for
   * another 12, so by the time anyone opens the page a good part of the forecast is
   * already history. This frame is where the timeline opens, where the past/future
   * boundary is drawn, and where forward-looking statistics start.
   *
   * Nearest rather than "the interval containing now": at 09:10, with frames ending
   * 09:00 and 12:00, the 09:00 picture is ten minutes old while the 12:00 one is
   * nearly three hours away. Using the containing interval also meant the frame the
   * app opened on was frequently labelled "already happened", since its interval had
   * just closed.
   */
  frameNearestTime(when: Date): number {
    const lead = this.leadHoursAt(when);
    let best = 0;
    let bestGap = Infinity;
    for (let f = 0; f < this.nFrames; f++) {
      const gap = Math.abs(this.stepEnd[f]! - lead);
      if (gap < bestGap) {
        bestGap = gap;
        best = f;
      }
    }
    return best;
  }

  /**
   * True when this frame sits before the one nearest the present.
   *
   * Defined against `frameNearestTime` rather than raw elapsed time so that the frame
   * the app opens on is never itself marked as past.
   */
  isPast(frame: number, now: Date): boolean {
    return frame < this.frameNearestTime(now);
  }

  /** Nearest grid cell to a geographic position, or null if outside the domain. */
  cellAt(lat: number, lon: number): { j: number; i: number } | null {
    const g = this.meta.grid;
    const j = Math.round((g.lat_first - lat) / Math.abs(g.lat_step));
    const i = Math.round((lon - g.lon_first) / g.lon_step);
    if (j < 0 || j >= this.nLat || i < 0 || i >= this.nLon) return null;
    return { j, i };
  }

  cellCentre(j: number, i: number): { lat: number; lon: number } {
    const g = this.meta.grid;
    return {
      lat: g.lat_first + j * g.lat_step,
      lon: g.lon_first + i * g.lon_step,
    };
  }

  rate(frame: number, j: number, i: number): number {
    return this.values[frame * this.cellsPerFrame + j * this.nLon + i]!;
  }

  /**
   * Full time series for one point, with interval and cumulative totals derived.
   *
   * `fromFrame` is where forward-looking figures start: peak, onset and the remaining
   * total all ignore intervals that have already elapsed, so the panel never promises
   * rain at a time that has been and gone.
   */
  seriesAt(
    lat: number,
    lon: number,
    { fromFrame = 0, onsetMm = 0.2 }: { fromFrame?: number; onsetMm?: number } = {},
  ): PointSeries | null {
    const cell = this.cellAt(lat, lon);
    if (!cell) return null;
    const { j, i } = cell;
    const centre = this.cellCentre(j, i);
    const start = Math.max(0, Math.min(this.nFrames - 1, fromFrame));

    const rate = new Float32Array(this.nFrames);
    const interval = new Float32Array(this.nFrames);
    const cumulative = new Float32Array(this.nFrames);

    let running = 0;
    let remainingTotal = 0;
    let peakRate = 0;
    let peakFrame = start;
    let onsetFrame: number | null = null;

    for (let f = 0; f < this.nFrames; f++) {
      const r = this.rate(f, j, i);
      rate[f] = r;
      const mm = r * this.hours[f]!;
      interval[f] = mm;
      running += mm;
      cumulative[f] = running;

      if (f < start) continue;
      remainingTotal += mm;
      if (r > peakRate) {
        peakRate = r;
        peakFrame = f;
      }
      if (onsetFrame === null && mm >= onsetMm) onsetFrame = f;
    }

    return {
      lat: centre.lat,
      lon: centre.lon,
      rate,
      interval,
      cumulative,
      total: running,
      fromFrame: start,
      remainingTotal,
      peakRate,
      peakFrame,
      rainingNow: interval[start]! >= onsetMm,
      onsetFrame,
    };
  }

  /** Paint one frame into an RGBA buffer sized `nLon * nLat`. */
  paintFrame(frame: number, out: Uint8ClampedArray): void {
    const base = frame * this.cellsPerFrame;
    for (let c = 0; c < this.cellsPerFrame; c++) {
      const k = rateToBucket(this.values[base + c]!) * 4;
      const o = c * 4;
      out[o] = RAIN_LUT[k]!;
      out[o + 1] = RAIN_LUT[k + 1]!;
      out[o + 2] = RAIN_LUT[k + 2]!;
      out[o + 3] = RAIN_LUT[k + 3]!;
    }
  }

  /**
   * Image corner coordinates for the raster overlay.
   *
   * The cube stores values at cell *centres*, so the image covers half a cell beyond
   * each edge. Without this the field would sit an eighth of a degree off.
   */
  imageCorners(): [number, number][] {
    const g = this.meta.grid;
    const half = g.step_deg / 2;
    const west = g.lon_min - half;
    const east = g.lon_max + half;
    const north = g.lat_max + half;
    const south = g.lat_min - half;
    return [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];
  }

  /** Largest interval total anywhere in the forecast, for a stable chart y-axis. */
  maxIntervalMm(): number {
    let max = 0;
    for (let f = 0; f < this.nFrames; f++) {
      const base = f * this.cellsPerFrame;
      const h = this.hours[f]!;
      for (let c = 0; c < this.cellsPerFrame; c++) {
        const mm = this.values[base + c]! * h;
        if (mm > max) max = mm;
      }
    }
    return max;
  }

  isWet(frame: number, j: number, i: number): boolean {
    return this.rate(frame, j, i) > DRY_THRESHOLD_MMH;
  }

  /**
   * Mean rain rate over an arbitrary lead-time window, weighted by overlap.
   *
   * Needed to compare models on equal terms: IFS is 3-hourly out to T+144h while AIFS
   * is uniformly 6-hourly, so a like-for-like difference has to average the finer
   * model over the coarser model's window rather than pick one sub-interval.
   */
  windowMeanRate(fromLead: number, toLead: number, j: number, i: number): number {
    const span = toLead - fromLead;
    if (span <= 0) return 0;
    let weighted = 0;
    for (let f = 0; f < this.nFrames; f++) {
      const a = Math.max(fromLead, this.stepStart[f]!);
      const b = Math.min(toLead, this.stepEnd[f]!);
      if (b > a) weighted += this.rate(f, j, i) * (b - a);
    }
    return weighted / span;
  }

  /** Fill `out` with this cube's mean rate over a lead-time window, cell by cell. */
  paintWindowInto(fromLead: number, toLead: number, out: Float32Array): void {
    out.fill(0);
    const span = toLead - fromLead;
    if (span <= 0) return;
    for (let f = 0; f < this.nFrames; f++) {
      const a = Math.max(fromLead, this.stepStart[f]!);
      const b = Math.min(toLead, this.stepEnd[f]!);
      if (b <= a) continue;
      const w = (b - a) / span;
      const base = f * this.cellsPerFrame;
      for (let c = 0; c < this.cellsPerFrame; c++) {
        out[c] += this.values[base + c]! * w;
      }
    }
  }

  /** Copy one frame's rates into `out`. */
  copyFrameInto(frame: number, out: Float32Array): void {
    const base = frame * this.cellsPerFrame;
    for (let c = 0; c < this.cellsPerFrame; c++) out[c] = this.values[base + c]!;
  }
}

/**
 * The two forecasts being compared, and the shared time windows they are compared on.
 *
 * The comparison window is the *coarser* model's interval — 6 h — because averaging the
 * finer model up is honest while interpolating the coarser one down is not.
 */
export class Comparison {
  readonly physics: Cube;
  readonly ai: Cube;
  /** Shared 6 h windows, as [fromLead, toLead] pairs. */
  readonly windows: { from: number; to: number; validTime: Date }[];

  constructor(physics: Cube, ai: Cube) {
    this.physics = physics;
    this.ai = ai;
    const maxLead = Math.min(physics.maxLead, ai.maxLead);
    this.windows = [];
    for (let f = 0; f < ai.nFrames; f++) {
      const to = ai.stepEnd[f]!;
      if (to > maxLead) break;
      this.windows.push({
        from: ai.stepStart[f]!,
        to,
        validTime: ai.validTimes[f]!,
      });
    }
  }

  /** Do both models come from the same analysis time? */
  get aligned(): boolean {
    return this.physics.runTime.getTime() === this.ai.runTime.getTime();
  }

  /** The shared window containing a lead time. */
  windowAtLead(lead: number): { from: number; to: number; validTime: Date } {
    for (const w of this.windows) {
      if (lead <= w.to) return w;
    }
    return this.windows[this.windows.length - 1]!;
  }

  /** Signed difference in mean rate (physics minus AI) over a shared window. */
  deltaAtLead(lead: number, out: Float32Array, scratch: Float32Array): void {
    const w = this.windowAtLead(lead);
    this.physics.paintWindowInto(w.from, w.to, out);
    this.ai.paintWindowInto(w.from, w.to, scratch);
    for (let c = 0; c < out.length; c++) out[c]! -= scratch[c]!;
  }

  /** Signed difference at one point, for the readout. */
  deltaAt(lead: number, j: number, i: number): number {
    const w = this.windowAtLead(lead);
    return (
      this.physics.windowMeanRate(w.from, w.to, j, i) -
      this.ai.windowMeanRate(w.from, w.to, j, i)
    );
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface LoadedData {
  index: DataIndex;
  /** Cubes by model key, e.g. "ifs" and "aifs". */
  cubes: Map<string, Cube>;
  /** The model shown by default. */
  primary: Cube;
  /** Present only when both a physics and an AI forecast were published. */
  comparison: Comparison | null;
}

async function loadCube(base: string, metaFile: string, signal?: AbortSignal) {
  const meta = await fetchJson<CubeMeta>(`${base}${metaFile}`);
  const res = await fetch(`${base}${meta.cube.file}`, {
    cache: "no-cache",
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`${meta.cube.file} -> HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength !== meta.cube.bytes) {
    throw new Error(
      `${meta.cube.file} is ${buffer.byteLength} bytes, metadata says ${meta.cube.bytes}`,
    );
  }
  const expected = meta.cube.n_frames * meta.grid.nlat * meta.grid.nlon;
  return new Cube(meta, decodeHalf(buffer, expected));
}

/**
 * Fetch the data index and every cube it lists.
 *
 * `BASE_URL` is respected so the same code works at the dev server root and under the
 * GitHub Pages project path. Cubes are fetched in parallel; together they are a little
 * over 500 KB on the wire.
 */
export async function loadData(signal?: AbortSignal): Promise<LoadedData> {
  const base = `${import.meta.env.BASE_URL}data/`;
  const index = await fetchJson<DataIndex>(`${base}index.json`);
  if (!index.models.length) throw new Error("data index lists no models");

  const loaded = await Promise.all(
    index.models.map(async (m) => [m.key, await loadCube(base, m.meta, signal)] as const),
  );
  const cubes = new Map(loaded);

  const primary = cubes.get("ifs") ?? loaded[0]![1];
  const ai = cubes.get("aifs") ?? null;
  const physics = cubes.get("ifs") ?? null;
  const comparison = physics && ai ? new Comparison(physics, ai) : null;

  return { index, cubes, primary, comparison };
}
