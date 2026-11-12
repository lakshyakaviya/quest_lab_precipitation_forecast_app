import type { Cube } from "../lib/cube";
import { BASEMAP_ATTRIBUTION, BASEMAP_NOTE } from "../map/basemapStyle";
import { dataAge, formatUtc } from "../lib/format";

/**
 * Required attribution, plus the provenance a reader needs to judge the forecast:
 * which model, which run, and how old the data is.
 *
 * ECMWF Open Data is CC BY 4.0, so crediting ECMWF is a licence condition, not a
 * courtesy.
 */
export function AttributionBar({ cube }: { cube: Cube }) {
  const source = cube.meta.source;
  return (
    <footer className="attrib">
      <p className="attrib__run">
        <strong>{cube.meta.model.label}</strong> {cube.meta.model.resolution}{" "}
        &middot; run {formatUtc(cube.runTime)} &middot; built{" "}
        {dataAge(new Date(cube.meta.generated_at))}
      </p>
      <p className="attrib__credit">
        Forecast data:{" "}
        <a href={source.url} target="_blank" rel="noreferrer noopener">
          {source.name}
        </a>{" "}
        &copy; ECMWF, licensed{" "}
        <a href={source.licence_url} target="_blank" rel="noreferrer noopener">
          {source.licence}
        </a>
        . {BASEMAP_ATTRIBUTION}.
      </p>
      <p className="attrib__note">
        Dashed outline marks the edge of the processed forecast domain, not the edge of
        the rain. {BASEMAP_NOTE}
      </p>
    </footer>
  );
}
