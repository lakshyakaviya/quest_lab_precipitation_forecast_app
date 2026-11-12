/** The contract written by `pipeline/src/precipitation/encode.py`. */

export interface GridMeta {
  nlon: number;
  nlat: number;
  lon_min: number;
  lon_max: number;
  lat_min: number;
  lat_max: number;
  step_deg: number;
  /** Row 0 is the northernmost row, so `lat_step` is negative. */
  lat_first: number;
  lat_last: number;
  lat_step: number;
  lon_first: number;
  lon_step: number;
}

export interface FrameMeta {
  i: number;
  step_start: number;
  step_end: number;
  /** Interval length in hours: 3 out to T+144h, then 6. */
  hours: number;
  valid_time: string;
}

export interface CubeMeta {
  schema: number;
  model: {
    key: string;
    label: string;
    opendata_model: string;
    stream: string;
    type: string;
    resolution: string;
  };
  run: { datetime: string; date: string; hour: string };
  generated_at: string;
  grid: GridMeta;
  cube: {
    file: string;
    dtype: "float16";
    byte_order: "little";
    layout: string;
    units: "mm/h";
    n_frames: number;
    bytes: number;
    sha256: string;
  };
  frames: FrameMeta[];
  stats: {
    min_mm_h: number;
    max_mm_h: number;
    mean_mm_h: number;
    wet_fraction: number;
  };
  deaccumulation: {
    clamped_cells: number;
    clamped_fraction: number;
    worst_decrement_m: number;
    worst_decrement_quanta: number;
    mass_added_fraction: number;
    packing_quantum_m: number;
  };
  source: {
    name: string;
    licence: string;
    licence_url: string;
    url: string;
  };
}

export interface DataIndex {
  schema: number;
  generated_at: string;
  models: {
    key: string;
    label: string;
    cube: string;
    meta: string;
    run: string;
    n_frames: number;
  }[];
  source: CubeMeta["source"];
}
