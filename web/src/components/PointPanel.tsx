import { useMemo, useState } from "react";

import type { Cube, PointSeries } from "../lib/cube";
import {
  coords,
  formatIst,
  formatIstDay,
  leadTime,
  mm,
  mmValue,
  rate as fmtRate,
  relativeTo,
} from "../lib/format";

const PHYSICS = "#3987e5"; // blue, categorical slot 1 (dark steps)
const AI = "#d95926"; // orange, categorical slot 2 (dark steps)
const PAST_OPACITY = 0.26;

export interface ModelSeries {
  key: string;
  label: string;
  cube: Cube;
  series: PointSeries;
  color: string;
}

interface Props {
  cube: Cube;
  series: PointSeries | null;
  aiCube: Cube | null;
  aiSeries: PointSeries | null;
  frame: number;
  now: Date;
  onFrameSelect: (frame: number) => void;
  onClear: () => void;
}

/**
 * Rainfall at one grid cell, for both forecasts.
 *
 * Interval rainfall and cumulative rainfall are two measures on different scales, so
 * they get **two charts** rather than one chart with two y-axes. With both models
 * present each chart carries two series and therefore a legend.
 *
 * Everything forward-looking is measured from the present, not from the forecast run,
 * and elapsed intervals are drawn dimmed behind a "now" marker.
 */
export function PointPanel({
  cube,
  series,
  aiCube,
  aiSeries,
  frame,
  now,
  onFrameSelect,
  onClear,
}: Props) {
  if (!series) {
    return (
      <aside className="panel panel--empty">
        <h2 className="panel__title">Rainfall at a point</h2>
        <p className="panel__prompt">
          Click anywhere on the map to see how rain builds up there over the rest of the
          forecast, and how the two models differ.
        </p>
      </aside>
    );
  }

  const models: ModelSeries[] = [
    {
      key: "ifs",
      label: cube.meta.model.label,
      cube,
      series,
      color: PHYSICS,
    },
  ];
  if (aiCube && aiSeries) {
    models.push({
      key: "aifs",
      label: aiCube.meta.model.label,
      cube: aiCube,
      series: aiSeries,
      color: AI,
    });
  }

  const peakTime = cube.validTimes[series.peakFrame]!;
  const onsetTime =
    series.onsetFrame === null ? null : cube.validTimes[series.onsetFrame]!;
  const endTime = cube.validTimes[cube.nFrames - 1]!;

  return (
    <aside className="panel">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">Rainfall at a point</h2>
          <p className="panel__coords">{coords(series.lat, series.lon)}</p>
        </div>
        <button type="button" className="panel__clear" onClick={onClear}>
          Clear
        </button>
      </header>

      <div className="hero">
        <span className="hero__value">{mm(series.remainingTotal)}</span>
        <span className="hero__unit">mm</span>
        <span className="hero__label">
          physics forecast from now to {formatIstDay(endTime)}
          {aiSeries && (
            <>
              {" "}
              · AI says <b>{mm(aiSeries.remainingTotal)} mm</b>
            </>
          )}
        </span>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile__label">Peak intensity</span>
          <span className="tile__value">
            {series.peakRate > 0 ? `${fmtRate(series.peakRate)} mm/h` : "None"}
          </span>
          <span className="tile__sub">
            {series.peakRate > 0 ? formatIst(peakTime) : "Dry for the rest of the run"}
          </span>
        </div>
        <div className="tile">
          <span className="tile__label">
            {series.rainingNow ? "Raining" : "Rain starts"}
          </span>
          <span className="tile__value">
            {series.rainingNow
              ? "Now"
              : onsetTime
                ? relativeTo(onsetTime, now)
                : "Stays dry"}
          </span>
          <span className="tile__sub">
            {series.rainingNow
              ? `${fmtRate(series.rate[series.fromFrame]!)} mm/h right now`
              : onsetTime
                ? formatIst(onsetTime)
                : "No interval reaches 0.2 mm"}
          </span>
        </div>
      </div>

      {aiSeries && (
        <Agreement physics={series} ai={aiSeries} />
      )}

      {models.length > 1 && (
        <ul className="serieskey" aria-label="Models shown">
          {models.map((m) => (
            <li key={m.key}>
              <span
                className="serieskey__swatch"
                style={{ background: m.color }}
                aria-hidden="true"
              />
              {m.label}
            </li>
          ))}
        </ul>
      )}

      <RateChart
        models={models}
        axisCube={cube}
        frame={frame}
        now={now}
        onFrameSelect={onFrameSelect}
      />
      <CumulativeChart
        models={models}
        axisCube={cube}
        frame={frame}
        now={now}
        onFrameSelect={onFrameSelect}
      />

      <details className="panel__table">
        <summary>View as a table</summary>
        <div className="panel__table-scroll">
          <table>
            <caption className="sr-only">
              Forecast rainfall at {coords(series.lat, series.lon)}
            </caption>
            <thead>
              <tr>
                <th scope="col">Valid (IST)</th>
                <th scope="col">Lead</th>
                <th scope="col">Rain (mm)</th>
                <th scope="col">Rate (mm/h)</th>
                <th scope="col">Cumulative (mm)</th>
              </tr>
            </thead>
            <tbody>
              {cube.meta.frames.map((f) => {
                const classes = [
                  f.i === frame ? "is-current" : "",
                  cube.isPast(f.i, now) ? "is-past" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={f.i} className={classes || undefined}>
                    <td>{formatIst(cube.validTimes[f.i]!)}</td>
                    <td>{leadTime(f.step_end)}</td>
                    <td>{mm(series.interval[f.i]!)}</td>
                    <td>{fmtRate(series.rate[f.i]!)}</td>
                    <td>{mm(series.cumulative[f.i]!)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="panel__table-note">
            Physics model ({cube.meta.model.label}) at its native 3-hourly resolution.
          </p>
        </div>
      </details>
    </aside>
  );
}

/** One plain sentence on whether the two forecasts tell the same story here. */
function Agreement({ physics, ai }: { physics: PointSeries; ai: PointSeries }) {
  // Rounded first, so the stated difference always equals the difference of the two
  // numbers shown above it. Using the raw totals made 149 and 49 read as "+99".
  const a = mmValue(physics.remainingTotal);
  const b = mmValue(ai.remainingTotal);
  const diff = a - b;
  const scale = Math.max(a, b);

  const wetter = diff > 0 ? "physics" : "AI";
  let verdict: string;
  if (scale < 1) {
    verdict = "Both models expect essentially no rain here.";
  } else if (Math.abs(diff) < 0.15 * scale) {
    verdict = "The two models closely agree here.";
  } else if (Math.abs(diff) < 0.4 * scale) {
    verdict = `Broadly similar, with the ${wetter} model a little wetter.`;
  } else if (Math.abs(diff) < 0.75 * scale) {
    verdict = `They differ: the ${wetter} model expects noticeably more rain.`;
  } else {
    verdict = `Strong disagreement — the ${wetter} model expects far more rain.`;
  }

  return (
    <p className="agreement">
      <span className="agreement__delta">
        {diff >= 0 ? "+" : "−"}
        {mm(Math.abs(diff))} mm
      </span>
      {verdict}
    </p>
  );
}

// --------------------------------------------------------------------------------------
// Charts
// --------------------------------------------------------------------------------------

const W = 560;
const PAD = { top: 14, right: 10, bottom: 22, left: 40 };
const GAP = 2;

interface ChartProps {
  models: ModelSeries[];
  /** Cube whose lead-time span defines the shared x axis. */
  axisCube: Cube;
  frame: number;
  now: Date;
  onFrameSelect: (frame: number) => void;
}

function useDayTicks(cube: Cube) {
  return useMemo(() => {
    const ticks: { lead: number; label: string }[] = [];
    let lastDay = "";
    cube.validTimes.forEach((t, i) => {
      const day = formatIstDay(t);
      if (day !== lastDay) {
        ticks.push({ lead: cube.stepEnd[i]!, label: day });
        lastDay = day;
      }
    });
    return ticks.filter((_, k) => k % 2 === 0);
  }, [cube]);
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (value <= m * pow) return m * pow;
  }
  return 10 * pow;
}

function useHover(cube: Cube, onFrameSelect: (frame: number) => void) {
  const [index, setIndex] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;

  const indexFromEvent = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const t = (vx - PAD.left) / plotW;
    if (t < 0 || t > 1) return null;
    const lead = t * cube.maxLead;
    for (let f = 0; f < cube.nFrames; f++) {
      if (lead <= cube.stepEnd[f]!) return f;
    }
    return cube.nFrames - 1;
  };

  return {
    index,
    handlers: {
      onPointerMove: (e: React.PointerEvent<SVGSVGElement>) =>
        setIndex(indexFromEvent(e)),
      onPointerLeave: () => setIndex(null),
      onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
        const i = indexFromEvent(e);
        if (i !== null) onFrameSelect(i);
      },
    },
  };
}

function NowMarker({ x, top, height }: { x: number; top: number; height: number }) {
  return (
    <g className="chart__now" aria-hidden="true">
      <line x1={x} x2={x} y1={top} y2={top + height} />
      <text x={x + 3} y={top + 8}>
        now
      </text>
    </g>
  );
}

/**
 * A step path: each forecast interval is a horizontal segment spanning its real
 * duration. This is what lets a 3-hourly and a 6-hourly model be drawn on one axis
 * without either being stretched or implying detail it does not have.
 */
function stepPath(
  cube: Cube,
  values: Float32Array,
  x: (lead: number) => number,
  y: (v: number) => number,
  from = 0,
  to = cube.nFrames - 1,
): string {
  const parts: string[] = [];
  for (let f = from; f <= to; f++) {
    const x0 = x(cube.stepStart[f]!);
    const x1 = x(cube.stepEnd[f]!);
    const yv = y(values[f]!);
    parts.push(`${f === from ? "M" : "L"}${x0.toFixed(1)},${yv.toFixed(1)}`);
    parts.push(`L${x1.toFixed(1)},${yv.toFixed(1)}`);
  }
  return parts.join(" ");
}

function RateChart({ models, axisCube, frame, now, onFrameSelect }: ChartProps) {
  const H = 156;
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const maxLead = axisCube.maxLead;
  const x = (lead: number) => PAD.left + (lead / maxLead) * plotW;
  const nowLead = Math.max(0, Math.min(maxLead, axisCube.leadHoursAt(now)));
  const ticks = useDayTicks(axisCube);
  const { index, handlers } = useHover(axisCube, onFrameSelect);

  const maxRate = niceMax(
    Math.max(...models.map((m) => Math.max(...m.series.rate))),
  );
  const y = (v: number) => PAD.top + plotH - (v / maxRate) * plotH;
  const active = index ?? frame;
  const single = models.length === 1;

  return (
    <figure className="chart">
      <figcaption className="chart__title">
        Rainfall rate <span className="chart__unit">mm/h</span>
        <span className="chart__note">
          {single
            ? "bar width is the forecast interval — 3 h, then 6 h after day 6"
            : "step width is each model's own interval — physics 3 h then 6 h, AI 6 h throughout"}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-label="Rainfall rate over time for each model"
        {...handlers}
      >
        {[0, maxRate / 2, maxRate].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 3.5} className="axis axis--y">
              {v === 0 ? "0" : fmtRate(v)}
            </text>
          </g>
        ))}

        <rect
          x={x(axisCube.stepStart[active]!)}
          y={PAD.top}
          width={Math.max(2, x(axisCube.stepEnd[active]!) - x(axisCube.stepStart[active]!))}
          height={plotH}
          className="chart__cursor"
        />

        {single
          ? Array.from({ length: axisCube.nFrames }, (_, i) => {
              const v = models[0]!.series.rate[i]!;
              if (v <= 0) return null;
              const x0 = x(axisCube.stepStart[i]!);
              const x1 = x(axisCube.stepEnd[i]!);
              const w = Math.max(1, Math.min(24, x1 - x0 - GAP));
              const h = Math.max(1.5, (v / maxRate) * plotH);
              return (
                <rect
                  key={i}
                  x={x0 + (x1 - x0 - w) / 2}
                  y={PAD.top + plotH - h}
                  width={w}
                  height={h}
                  rx={Math.min(2, w / 2)}
                  fill={models[0]!.color}
                  opacity={axisCube.isPast(i, now) ? PAST_OPACITY : 1}
                />
              );
            })
          : models.map((m) => {
              const split = m.series.fromFrame;
              return (
                <g key={m.key}>
                  <path
                    d={stepPath(m.cube, m.series.rate, x, y, 0, split)}
                    fill="none"
                    stroke={m.color}
                    strokeOpacity={PAST_OPACITY}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  <path
                    d={stepPath(m.cube, m.series.rate, x, y, split, m.cube.nFrames - 1)}
                    fill="none"
                    stroke={m.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          className="baseline"
        />

        {nowLead > 0 && nowLead < maxLead && (
          <NowMarker x={x(nowLead)} top={PAD.top} height={plotH} />
        )}

        {ticks.map((t) => (
          <text key={t.lead} x={x(t.lead)} y={H - 6} className="axis axis--x">
            {t.label}
          </text>
        ))}
      </svg>
      <Tooltip models={models} axisCube={axisCube} index={index} kind="rate" />
    </figure>
  );
}

function CumulativeChart({ models, axisCube, frame, now, onFrameSelect }: ChartProps) {
  const H = 126;
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const maxLead = axisCube.maxLead;
  const x = (lead: number) => PAD.left + (lead / maxLead) * plotW;
  const nowLead = Math.max(0, Math.min(maxLead, axisCube.leadHoursAt(now)));
  const ticks = useDayTicks(axisCube);
  const { index, handlers } = useHover(axisCube, onFrameSelect);

  const max = niceMax(Math.max(...models.map((m) => m.series.total)));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const linePath = (m: ModelSeries, from: number, to: number) => {
    if (to <= from) return "";
    const parts: string[] = [];
    for (let i = from; i <= to; i++) {
      parts.push(
        `${i === from ? "M" : "L"}${x(m.cube.stepEnd[i]!).toFixed(1)},${y(m.series.cumulative[i]!).toFixed(1)}`,
      );
    }
    return parts.join(" ");
  };

  const active = index ?? frame;

  return (
    <figure className="chart">
      <figcaption className="chart__title">
        Cumulative rainfall <span className="chart__unit">mm</span>
        <span className="chart__note">from the start of the forecast run</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-label="Cumulative rainfall over time for each model"
        {...handlers}
      >
        {[0, max].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 3.5} className="axis axis--y">
              {v === 0 ? "0" : mm(v)}
            </text>
          </g>
        ))}

        <line
          x1={x(axisCube.stepEnd[active]!)}
          x2={x(axisCube.stepEnd[active]!)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          className="chart__crosshair"
        />

        {models.length === 1 && (
          <path
            d={`${linePath(models[0]!, 0, models[0]!.cube.nFrames - 1)} L${x(maxLead).toFixed(1)},${y(0).toFixed(1)} L${x(models[0]!.cube.stepEnd[0]!).toFixed(1)},${y(0).toFixed(1)} Z`}
            fill={models[0]!.color}
            fillOpacity={0.08}
          />
        )}

        {models.map((m) => {
          const split = m.series.fromFrame;
          return (
            <g key={m.key}>
              <path
                d={linePath(m, 0, split)}
                fill="none"
                stroke={m.color}
                strokeOpacity={PAST_OPACITY}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={linePath(m, split, m.cube.nFrames - 1)}
                fill="none"
                stroke={m.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        <circle
          cx={x(axisCube.stepEnd[active]!)}
          cy={y(models[0]!.series.cumulative[active]!)}
          r={4}
          fill={models[0]!.color}
          className="chart__dot"
        />

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          className="baseline"
        />

        {nowLead > 0 && nowLead < maxLead && (
          <NowMarker x={x(nowLead)} top={PAD.top} height={plotH} />
        )}

        {ticks.map((t) => (
          <text key={t.lead} x={x(t.lead)} y={H - 6} className="axis axis--x">
            {t.label}
          </text>
        ))}
      </svg>
      <Tooltip models={models} axisCube={axisCube} index={index} kind="cumulative" />
    </figure>
  );
}

function Tooltip({
  models,
  axisCube,
  index,
  kind,
}: {
  models: ModelSeries[];
  axisCube: Cube;
  index: number | null;
  kind: "rate" | "cumulative";
}) {
  if (index === null) return <p className="tip tip--placeholder">&nbsp;</p>;
  const f = axisCube.meta.frames[index]!;
  const lead = axisCube.stepEnd[index]!;

  return (
    <p className="tip" role="status">
      {formatIst(axisCube.validTimes[index]!)} · {leadTime(f.step_end)}
      {models.map((m) => {
        // Each model is read at its own frame covering this lead time.
        let mf = m.cube.nFrames - 1;
        for (let k = 0; k < m.cube.nFrames; k++) {
          if (lead <= m.cube.stepEnd[k]!) {
            mf = k;
            break;
          }
        }
        const value =
          kind === "rate"
            ? `${fmtRate(m.series.rate[mf]!)} mm/h`
            : `${mm(m.series.cumulative[mf]!)} mm`;
        return (
          <span key={m.key} className="tip__item">
            <span
              className="tip__key"
              style={{ background: m.color }}
              aria-hidden="true"
            />
            <b>{value}</b>
          </span>
        );
      })}
    </p>
  );
}
