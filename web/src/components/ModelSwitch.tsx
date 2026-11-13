import { useState } from "react";

import type { Comparison } from "../lib/cube";
import type { ViewMode } from "../map/MapView";
import { formatUtc } from "../lib/format";

const MODES: { key: ViewMode; label: string; hint: string }[] = [
  { key: "ifs", label: "Physics", hint: "IFS HRES, ECMWF's operational physics model" },
  { key: "aifs", label: "AI", hint: "AIFS Single, ECMWF's data-driven model" },
  { key: "compare", label: "Compare", hint: "Drag the divider to swipe between them" },
  { key: "delta", label: "Disagree", hint: "Where the two models differ, and by how much" },
];

interface Props {
  mode: ViewMode;
  comparison: Comparison | null;
  onMode: (mode: ViewMode) => void;
}

/**
 * Switch between the physics forecast, the AI forecast, and the two ways of putting
 * them side by side.
 *
 * Disabled entirely when only one model was published, which happens when the two
 * models' newest complete runs do not line up.
 */
export function ModelSwitch({ mode, comparison, onMode }: Props) {
  const [showAbout, setShowAbout] = useState(false);
  const available = comparison !== null;

  return (
    <div className="switch">
      <div className="switch__group" role="group" aria-label="Forecast model">
        {MODES.map((m) => {
          const enabled = available || m.key === "ifs";
          return (
            <button
              key={m.key}
              type="button"
              className={m.key === mode ? "is-active" : undefined}
              onClick={() => onMode(m.key)}
              disabled={!enabled}
              aria-pressed={m.key === mode}
              title={enabled ? m.hint : "Needs both models from the same run"}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="switch__about"
        onClick={() => setShowAbout((v) => !v)}
        aria-expanded={showAbout}
      >
        What is this?
      </button>

      {showAbout && (
        <div className="about" role="region" aria-label="About the comparison">
          <p>
            <strong>IFS HRES</strong> is ECMWF's operational forecast: physics, solved
            on a grid, the method weather forecasting has used for decades.{" "}
            <strong>AIFS Single</strong> is ECMWF's data-driven model, which learned
            atmospheric evolution from decades of reanalysis instead of solving
            equations.
          </p>
          <p>
            Both run from the same analysis, so where they disagree the difference is
            the <em>method</em>, not the starting point. Neither is ground truth. AI
            models tend to produce smoother, less extreme rainfall — something you can
            see directly here, and a known open problem for them.
          </p>
          {comparison && (
            <dl className="about__stats">
              <div>
                <dt>Peak rate, physics</dt>
                <dd>{comparison.physics.meta.stats.max_mm_h.toFixed(1)} mm/h</dd>
              </div>
              <div>
                <dt>Peak rate, AI</dt>
                <dd>{comparison.ai.meta.stats.max_mm_h.toFixed(1)} mm/h</dd>
              </div>
              <div>
                <dt>Area raining, physics</dt>
                <dd>{(comparison.physics.meta.stats.wet_fraction * 100).toFixed(0)}%</dd>
              </div>
              <div>
                <dt>Area raining, AI</dt>
                <dd>{(comparison.ai.meta.stats.wet_fraction * 100).toFixed(0)}%</dd>
              </div>
            </dl>
          )}
          <p>
            <strong>This is total precipitation, not just rain.</strong> Over the
            Himalaya and Kashmir in winter most of it falls as snow, shown here as the
            depth of water it would melt into — so 10 mm over Srinagar is roughly 10 cm
            of snow, not 10 mm of rain.
          </p>
          {comparison && (
            <p className="about__note">
              {comparison.aligned
                ? `Both from the ${formatUtc(comparison.physics.runTime)} run. Differences are compared over 6-hourly windows, the coarsest interval the two share.`
                : "Warning: these forecasts are from different runs, so part of any difference is the starting point rather than the method."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
