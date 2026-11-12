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
  /** Total over the whole forecast, mm. */
  total: number;
  /** Peak rate over the forecast, mm/h. */
  peakRate: number;
  /** Frame index of the peak. */
  peakFrame: number;
  /** First frame whose interval total reaches `onsetMm`, or null if it stays dry. */
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
  }

  get runTime(): Date {
    return new Date(this.meta.run.datetime);
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

  /** Full time series for one point, with interval and cumulative totals derived. */
  seriesAt(lat: number, lon: number, onsetMm = 0.2): PointSeries | null {
    const cell = this.cellAt(lat, lon);
    if (!cell) return null;
    const { j, i } = cell;
    const centre = this.cellCentre(j, i);

    const rate = new Float32Array(this.nFrames);
    const interval = new Float32Array(this.nFrames);
    const cumulative = new Float32Array(this.nFrames);

    let running = 0;
    let peakRate = 0;
    let peakFrame = 0;
    let onsetFrame: number | null = null;

    for (let f = 0; f < this.nFrames; f++) {
      const r = this.rate(f, j, i);
      rate[f] = r;
      const mm = r * this.hours[f]!;
      interval[f] = mm;
      running += mm;
      cumulative[f] = running;
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
      peakRate,
      peakFrame,
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
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface LoadedData {
  index: DataIndex;
  cube: Cube;
}

/**
 * Fetch the data index, then the first model's metadata and cube.
 *
 * `BASE_URL` is respected so the same code works at the dev server root and under the
 * GitHub Pages project path.
 */
export async function loadData(signal?: AbortSignal): Promise<LoadedData> {
  const base = `${import.meta.env.BASE_URL}data/`;
  const index = await fetchJson<DataIndex>(`${base}index.json`);
  const first = index.models[0];
  if (!first) throw new Error("data index lists no models");

  const meta = await fetchJson<CubeMeta>(`${base}${first.meta}`);

  const res = await fetch(`${base}${meta.cube.file}`, {
    cache: "no-cache",
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`${meta.cube.file} -> HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();

  if (buffer.byteLength !== meta.cube.bytes) {
    throw new Error(
      `cube is ${buffer.byteLength} bytes, metadata says ${meta.cube.bytes}`,
    );
  }
  const expected = meta.cube.n_frames * meta.grid.nlat * meta.grid.nlon;
  const values = decodeHalf(buffer, expected);

  return { index, cube: new Cube(meta, values) };
}
