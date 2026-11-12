/**
 * A fully self-contained MapLibre style.
 *
 * There is no external tile server and no glyph server: the geometry is a 137 KB
 * Natural Earth extract bundled into the app, and place labels are React DOM overlays
 * rather than symbol layers (which would need a glyphs URL). So the map has no
 * third-party uptime dependency, no API key, and nothing to rate-limit — it renders
 * the instant the page loads.
 *
 * The canvas is deliberately dark in every theme. A rain field only reads against a
 * dark surface, which is why radar and satellite displays are dark.
 */

import type {
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import basemap from "../assets/basemap.json";

export const MAP_COLORS = {
  sea: "#091016",
  land: "#1a1a19",
  coast: "#52514e",
  countryBorder: "#3a3a37",
  stateBorder: "#2e2e2b",
} as const;

export const RAIN_SOURCE_ID = "rain";
export const RAIN_LAYER_ID = "rain-raster";
export const RAIN_CANVAS_ID = "rain-canvas";

export const BASEMAP_ATTRIBUTION = basemap.attribution;
export const BASEMAP_NOTE = basemap.note;

/** [west, south, east, north] extent the bundled geometry actually covers. */
export const basemapBbox = basemap.bbox as [number, number, number, number];

/** Layers drawn above the rain field, so borders stay readable through the rain. */
const OVERLAY_LAYERS: LayerSpecification[] = [
  {
    id: "india-states",
    type: "line",
    source: "india-states",
    paint: {
      "line-color": MAP_COLORS.stateBorder,
      "line-width": 0.6,
      "line-opacity": 0.9,
    },
  },
  {
    id: "country-borders",
    type: "line",
    source: "countries",
    paint: {
      "line-color": MAP_COLORS.countryBorder,
      "line-width": 0.8,
    },
  },
  {
    id: "coastline",
    type: "line",
    source: "land",
    paint: {
      "line-color": MAP_COLORS.coast,
      "line-width": 1,
      "line-opacity": 0.75,
    },
  },
];

export function buildStyle(rainCorners: [number, number][]): StyleSpecification {
  const coordinates = rainCorners as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];

  // The rain field stops dead at the edge of the processed window. Outlining that
  // window tells the reader it is the limit of the data rather than the limit of the
  // rain — an unexplained straight edge reads as a rendering fault.
  const domain = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [...coordinates, coordinates[0]],
        },
      },
    ],
  };

  return {
    version: 8,
    name: "Monsoon Lens",
    // No glyphs/sprite entries: nothing in this style needs them.
    sources: {
      land: { type: "geojson", data: basemap.land as never },
      countries: { type: "geojson", data: basemap.countries as never },
      "india-states": { type: "geojson", data: basemap.india_states as never },
      domain: { type: "geojson", data: domain },
      [RAIN_SOURCE_ID]: {
        type: "canvas",
        canvas: RAIN_CANVAS_ID,
        coordinates,
        animate: true,
      } as never,
    },
    layers: [
      {
        id: "sea",
        type: "background",
        paint: { "background-color": MAP_COLORS.sea },
      },
      {
        id: "land",
        type: "fill",
        source: "land",
        paint: { "fill-color": MAP_COLORS.land },
      },
      {
        id: RAIN_LAYER_ID,
        type: "raster",
        source: RAIN_SOURCE_ID,
        paint: {
          // Zero fade: the canvas is swapped deliberately, frame by frame, and a
          // cross-fade would smear consecutive forecast steps together.
          "raster-fade-duration": 0,
          "raster-opacity": 1,
          // Bilinear smoothing across the 0.25 degree cells. The underlying data is
          // cell-average, so this is presentational: the point panel always reports
          // the exact cell value.
          "raster-resampling": "linear",
        },
      },
      ...OVERLAY_LAYERS,
      {
        id: "domain-edge",
        type: "line",
        source: "domain",
        paint: {
          "line-color": "#898781",
          "line-width": 1,
          "line-opacity": 0.35,
          "line-dasharray": [3, 3],
        },
      },
    ],
  };
}
