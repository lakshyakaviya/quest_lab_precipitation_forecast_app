import { LEGEND_BANDS } from "../lib/colormap";

/**
 * Legend for the rain field.
 *
 * The scale is logarithmic because rainfall is: the difference between 0.2 and 2 mm/h
 * matters as much as the difference between 20 and 60. Bands are labelled by their
 * lower bound, as weather scales conventionally are.
 */
export function Legend() {
  return (
    <div className="legend" aria-label="Rain rate scale, millimetres per hour">
      <span className="legend__title">mm/h</span>
      <ol className="legend__bands">
        {LEGEND_BANDS.map((band) => (
          <li key={band.from} className="legend__band">
            <span
              className="legend__swatch"
              style={{ background: band.css }}
              aria-hidden="true"
            />
            <span className="legend__label">{band.from}</span>
          </li>
        ))}
      </ol>
      <span className="legend__scale">log scale</span>
    </div>
  );
}
