import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Cube } from "../lib/cube";
import { PLACES } from "../data/cities";
import { coords, rate as fmtRate } from "../lib/format";
import { CanvasRainSurface } from "./RainLayer";
import { RAIN_CANVAS_ID, basemapBbox, buildStyle } from "./basemapStyle";

export interface SelectedPoint {
  lat: number;
  lon: number;
}

interface Props {
  cube: Cube;
  frame: number;
  playing: boolean;
  selected: SelectedPoint | null;
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

export function MapView({ cube, frame, playing, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const surfaceRef = useRef<CanvasRainSurface | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    lat: number;
    lon: number;
    mmh: number;
  } | null>(null);

  // Keep the latest frame available to the click/move handlers without re-binding them.
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const handleSelect = useCallback(onSelect, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const surface = new CanvasRainSurface(cube);
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
      surface.setFrame(frameRef.current);

      for (const place of PLACES) {
        new Marker({ element: placeElement(place.name, place.rank), anchor: "left" })
          .setLngLat([place.lon, place.lat])
          .addTo(map);
      }
      setReady(true);
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
        mmh: cube.rate(frameRef.current, cell.j, cell.i),
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
  }, [cube, handleSelect]);

  // Frame changes: repaint the field, and refresh the hover readout in place so the
  // number under the cursor stays truthful while the animation runs.
  useEffect(() => {
    surfaceRef.current?.setFrame(frame);
    setHover((prev) => {
      if (!prev) return prev;
      const cell = cube.cellAt(prev.lat, prev.lon);
      if (!cell) return prev;
      return { ...prev, mmh: cube.rate(frame, cell.j, cell.i) };
    });
  }, [frame, cube]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !ready) return;
    if (playing) surface.startAnimating();
    else surface.stopAnimating();
  }, [playing, ready]);

  // The selection pin.
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
      {hover && (
        <div
          className="readout"
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          <strong>{fmtRate(hover.mmh)}</strong> mm/h
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
