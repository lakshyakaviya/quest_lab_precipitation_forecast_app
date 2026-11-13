import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Comparison, Cube } from "../lib/cube";
import { PLACES } from "../data/cities";
import { coords, rate as fmtRate } from "../lib/format";
import { CanvasRainSurface } from "./RainLayer";
import { RAIN_CANVAS_ID, basemapBbox, buildStyle } from "./basemapStyle";

export type ViewMode = "ifs" | "aifs" | "compare" | "delta";

export interface SelectedPoint {
  lat: number;
  lon: number;
}

interface Props {
  cube: Cube;
  comparison: Comparison | null;
  mode: ViewMode;
  frame: number;
  playing: boolean;
  selected: SelectedPoint | null;
  split: number;
  onSplit: (fraction: number) => void;
  onSelect: (point: SelectedPoint) => void;
}

/**
 * The whole country in frame: Kanyakumari and Sri Lanka at the bottom, Kashmir at the
 * top, the Northeast at the right. The latitude span is the binding one, so it is set
 * generously — an earlier, tighter box let a landscape viewport crop South India away.
 */
const INITIAL_BOUNDS: [[number, number], [number, number]] = [
  [67, 5.5],
  [98, 36.5],
];

/**
 * Panning is capped at the bundled basemap's own extent, so the straight edge where
 * the Natural Earth extract was clipped can never come into view.
 */
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [basemapBbox[0], basemapBbox[1]],
  [basemapBbox[2], basemapBbox[3]],
];

function placeElement(name: string, rank: 1 | 2): HTMLElement {
  const el = document.createElement("div");
  el.className = `place place--r${rank}`;
  el.innerHTML = `<span class="place__dot"></span><span class="place__name">${name}</span>`;
  return el;
}

function selectionElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "pin";
  el.setAttribute("aria-hidden", "true");
  return el;
}

export function MapView({
  cube,
  comparison,
  mode,
  frame,
  playing,
  selected,
  split,
  onSplit,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const surfaceRef = useRef<CanvasRainSurface | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const fieldRef = useRef<Float32Array>(new Float32Array(cube.nLat * cube.nLon));
  const scratchRef = useRef<Float32Array>(new Float32Array(cube.nLat * cube.nLon));
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    lat: number;
    lon: number;
    label: string;
  } | null>(null);

  // Latest render inputs, readable from map event handlers without re-binding them.
  const stateRef = useRef({ mode, frame, comparison, split });
  stateRef.current = { mode, frame, comparison, split };

  const handleSelect = useCallback(onSelect, [onSelect]);

  /**
   * Compose the field currently on screen.
   *
   * In `compare` the split is done in *data* space rather than with two map instances:
   * the raster is ours to paint, so columns west of the divider are taken from the
   * physics model and columns east of it from the AI model. One map, one texture.
   */
  const repaint = useCallback(() => {
    const surface = surfaceRef.current;
    const map = mapRef.current;
    if (!surface || !map) return;
    const { mode: m, frame: f, comparison: cmp, split: s } = stateRef.current;
    const field = fieldRef.current;
    const scratch = scratchRef.current;
    const lead = cube.stepEnd[f] ?? 0;

    if (m === "delta" && cmp) {
      cmp.deltaAtLead(lead, field, scratch);
      surface.setField(field, "delta");
      return;
    }

    if (m === "aifs" && cmp) {
      const w = cmp.windowAtLead(lead);
      cmp.ai.paintWindowInto(w.from, w.to, field);
      surface.setField(field, "rain");
      return;
    }

    if (m === "compare" && cmp) {
      cube.copyFrameInto(f, field);
      const w = cmp.windowAtLead(lead);
      cmp.ai.paintWindowInto(w.from, w.to, scratch);
      // Screen x of the divider -> longitude -> grid column. Longitude is linear in x
      // in Web Mercator, so this stays correct through pan and zoom.
      const width = map.getContainer().clientWidth;
      const splitLon = map.unproject([width * s, 0]).lng;
      const g = cube.meta.grid;
      const splitCol = Math.round((splitLon - g.lon_first) / g.lon_step);
      for (let j = 0; j < cube.nLat; j++) {
        const row = j * cube.nLon;
        for (let i = Math.max(0, splitCol); i < cube.nLon; i++) {
          field[row + i] = scratch[row + i]!;
        }
      }
      surface.setField(field, "rain");
      return;
    }

    cube.copyFrameInto(f, field);
    surface.setField(field, "rain");
  }, [cube]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const surface = new CanvasRainSurface(cube.nLon, cube.nLat);
    surface.canvas.id = RAIN_CANVAS_ID;
    surfaceRef.current = surface;

    const map = new maplibregl.Map({
      container,
      style: buildStyle(cube.imageCorners()),
      bounds: INITIAL_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      // The forecast grid is 0.25 degrees; zooming past this only magnifies pixels.
      maxZoom: 9,
      minZoom: 3,
      dragRotate: false,
      pitchWithRotate: false,
      maxBounds: MAX_BOUNDS,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    map.on("load", () => {
      surface.attach(map);
      repaint();
      for (const place of PLACES) {
        new Marker({ element: placeElement(place.name, place.rank), anchor: "left" })
          .setLngLat([place.lon, place.lat])
          .addTo(map);
      }
      setReady(true);
    });

    // In compare mode the data split depends on the camera, so it must follow moves.
    map.on("move", () => {
      if (stateRef.current.mode === "compare") repaint();
    });

    map.on("click", (e) => {
      handleSelect({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    map.on("mousemove", (e) => {
      const cell = cube.cellAt(e.lngLat.lat, e.lngLat.lng);
      if (!cell) {
        setHover(null);
        return;
      }
      const centre = cube.cellCentre(cell.j, cell.i);
      setHover({
        x: e.point.x,
        y: e.point.y,
        lat: centre.lat,
        lon: centre.lon,
        label: readoutLabel(cube, stateRef.current, cell.j, cell.i),
      });
    });
    map.on("mouseout", () => setHover(null));

    return () => {
      surface.destroy();
      map.remove();
      mapRef.current = null;
      surfaceRef.current = null;
      pinRef.current = null;
      setReady(false);
    };
  }, [cube, handleSelect, repaint]);

  // Repaint whenever what should be on screen changes, and refresh the readout under
  // the cursor so the number stays truthful while the animation runs.
  useEffect(() => {
    repaint();
    setHover((prev) => {
      if (!prev) return prev;
      const cell = cube.cellAt(prev.lat, prev.lon);
      if (!cell) return prev;
      return {
        ...prev,
        label: readoutLabel(cube, stateRef.current, cell.j, cell.i),
      };
    });
  }, [frame, mode, split, comparison, cube, repaint]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !ready) return;
    if (playing) surface.startAnimating();
    else surface.stopAnimating();
  }, [playing, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!selected) {
      pinRef.current?.remove();
      pinRef.current = null;
      return;
    }
    if (!pinRef.current) {
      // setLngLat must precede addTo: Marker.addTo() reads the position immediately
      // and throws on an unpositioned marker.
      pinRef.current = new Marker({ element: selectionElement(), anchor: "center" })
        .setLngLat([selected.lon, selected.lat])
        .addTo(map);
      return;
    }
    pinRef.current.setLngLat([selected.lon, selected.lat]);
  }, [selected, ready]);

  return (
    <div className="map">
      <div ref={containerRef} className="map__canvas" />

      {mode === "compare" && comparison && (
        <SwipeDivider split={split} onSplit={onSplit} />
      )}

      {hover && (
        <div
          className="readout"
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          <strong>{hover.label}</strong>
          <span className="readout__coords">{coords(hover.lat, hover.lon)}</span>
        </div>
      )}

      {!selected && (
        <p className="map__hint" role="status">
          Click anywhere for a rainfall timeline
        </p>
      )}
    </div>
  );
}

function readoutLabel(
  cube: Cube,
  state: { mode: ViewMode; frame: number; comparison: Comparison | null },
  j: number,
  i: number,
): string {
  const lead = cube.stepEnd[state.frame] ?? 0;
  const cmp = state.comparison;
  if (state.mode === "delta" && cmp) {
    const d = cmp.deltaAt(lead, j, i);
    if (Math.abs(d) < 0.05) return "models agree";
    return `${d > 0 ? "IFS" : "AIFS"} +${fmtRate(Math.abs(d))} mm/h`;
  }
  if (state.mode === "aifs" && cmp) {
    const w = cmp.windowAtLead(lead);
    return `${fmtRate(cmp.ai.windowMeanRate(w.from, w.to, j, i))} mm/h`;
  }
  return `${fmtRate(cube.rate(state.frame, j, i))} mm/h`;
}

/** Draggable divider for the side-by-side comparison. */
function SwipeDivider({
  split,
  onSplit,
}: {
  split: number;
  onSplit: (fraction: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const move = (clientX: number) => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    onSplit(Math.min(0.95, Math.max(0.05, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={ref}
      className="swipe"
      style={{ left: `${split * 100}%` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          onSplit(
            Math.min(0.95, Math.max(0.05, split + (e.key === "ArrowLeft" ? -0.04 : 0.04))),
          );
        }
      }}
      role="slider"
      tabIndex={0}
      aria-label="Comparison divider: physics model on the left, AI model on the right"
      aria-valuemin={5}
      aria-valuemax={95}
      aria-valuenow={Math.round(split * 100)}
    >
      <span className="swipe__line" aria-hidden="true" />
      <span className="swipe__grip" aria-hidden="true">
        ‹ ›
      </span>
      <span className="swipe__tag swipe__tag--left" aria-hidden="true">
        IFS physics
      </span>
      <span className="swipe__tag swipe__tag--right" aria-hidden="true">
        AIFS AI
      </span>
    </div>
  );
}
