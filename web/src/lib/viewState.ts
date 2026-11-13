/**
 * The view encoded in the URL hash, so any view can be linked to.
 *
 * Frames are addressed by **lead time in hours**, not by frame index: indices mean
 * different things to the two models and shift whenever the step list changes, while
 * T+78h is the same forecast moment in any run. A link therefore keeps meaning as new
 * runs replace old ones, which is the point — the forecast under it will have changed,
 * but the view will not have silently moved.
 */

export interface ViewState {
  mode: string;
  /** Lead time in hours of the displayed frame. */
  lead: number | null;
  lat: number | null;
  lon: number | null;
  /** Swipe divider position, 0.05–0.95. */
  split: number | null;
}

const MODES = new Set(["ifs", "aifs", "compare", "delta"]);

export function parseViewState(hash: string): Partial<ViewState> {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return {};
  const params = new URLSearchParams(raw);
  const out: Partial<ViewState> = {};

  const mode = params.get("v");
  if (mode && MODES.has(mode)) out.mode = mode;

  const lead = Number(params.get("t"));
  if (params.has("t") && Number.isFinite(lead) && lead >= 0) out.lead = lead;

  const at = params.get("at");
  if (at) {
    const [lat, lon] = at.split(",").map(Number);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat!) <= 90 &&
      Math.abs(lon!) <= 180
    ) {
      out.lat = lat!;
      out.lon = lon!;
    }
  }

  const split = Number(params.get("s"));
  if (params.has("s") && Number.isFinite(split) && split > 0 && split < 1) {
    out.split = split;
  }
  return out;
}

export function buildHash(state: ViewState): string {
  const params = new URLSearchParams();
  params.set("v", state.mode);
  if (state.lead !== null) params.set("t", String(Math.round(state.lead)));
  if (state.lat !== null && state.lon !== null) {
    params.set("at", `${state.lat.toFixed(2)},${state.lon.toFixed(2)}`);
  }
  // Only worth encoding when the divider is actually in use and has been moved.
  if (state.mode === "compare" && state.split !== null) {
    params.set("s", state.split.toFixed(2));
  }
  return `#${params.toString()}`;
}
