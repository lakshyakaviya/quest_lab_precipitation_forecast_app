import { useMemo, useState } from "react";

import type { Cube, PointSeries } from "../lib/cube";
import {
  coords,
  formatIst,
  formatIstDay,
  leadTime,
  mm,
  rate as fmtRate,
  relativeFromRun,
} from "../lib/format";

const SERIES = "#3987e5"; // blue, categorical slot 1 (dark steps)

interface Props {
  cube: Cube;
  series: PointSeries | null;
  frame: number;
  onFrameSelect: (frame: number) => void;
  onClear: () => void;
}

/**
 * Rainfall at one grid cell.
 *
 * Interval rainfall and cumulative rainfall are two measures on different scales, so
 * they get **two charts** rather than one chart with two y-axes. Each has a single
 * series, so neither needs a legend: the chart's own title names what is plotted.
 */
export function PointPanel({ cube, series, frame, onFrameSelect, onClear }: Props) {
  if (!series) {
    return (
      <aside className="panel panel--empty">
        <h2 className="panel__title">Rainfall at a point</h2>
        <p className="panel__prompt">
          Click anywhere on the map to see how rain builds up there over the next ten
          days.
        </p>
      </aside>
    );
  }

  const peakTime = cube.validTimes[series.peakFrame]!;
  const onsetTime =
    series.onsetFrame === null ? null : cube.validTimes[series.onsetFrame]!;

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
        <span className="hero__value">{mm(series.total)}</span>
        <span className="hero__unit">mm</span>
        <span className="hero__label">
          total over {Math.round(cube.hours.reduce((a, b) => a + b, 0) / 24)} days
        </span>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile__label">Peak intensity</span>
          <span className="tile__value">{fmtRate(series.peakRate)} mm/h</span>
          <span className="tile__sub">{formatIst(peakTime)}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Rain starts</span>
          <span className="tile__value">
            {onsetTime ? relativeFromRun(cube.runTime, onsetTime) : "Stays dry"}
          </span>
          <span className="tile__sub">
            {onsetTime ? formatIst(onsetTime) : "No interval reaches 0.2 mm"}
          </span>
        </div>
      </div>

      <IntervalChart
        cube={cube}
        series={series}
        frame={frame}
        onFrameSelect={onFrameSelect}
      />
      <CumulativeChart
        cube={cube}
        series={series}
        frame={frame}
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
              {cube.meta.frames.map((f) => (
                <tr key={f.i} className={f.i === frame ? "is-current" : undefined}>
                  <td>{formatIst(cube.validTimes[f.i]!)}</td>
                  <td>{leadTime(f.step_end)}</td>
                  <td>{mm(series.interval[f.i]!)}</td>
                  <td>{fmtRate(series.rate[f.i]!)}</td>
                  <td>{mm(series.cumulative[f.i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </aside>
  );
}

// --------------------------------------------------------------------------------------
// Charts
// --------------------------------------------------------------------------------------

const W = 560;
const PAD = { top: 12, right: 10, bottom: 22, left: 40 };
const GAP = 2; // the surface gap that separates adjacent bars

interface ChartProps {
  cube: Cube;
  series: PointSeries;
  frame: number;
  onFrameSelect: (frame: number) => void;
}

/** Ticks at IST midnight, so the x axis reads as days rather than step numbers. */
function useDayTicks(cube: Cube) {
  return useMemo(() => {
    const ticks: { i: number; label: string }[] = [];
    let lastDay = "";
    cube.validTimes.forEach((t, i) => {
      const day = formatIstDay(t);
      if (day !== lastDay) {
        ticks.push({ i, label: day });
        lastDay = day;
      }
    });
    // Every other day, so labels never collide at this width.
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

function useHover(n: number, onFrameSelect: (frame: number) => void) {
  const [index, setIndex] = useState<number | null>(null);
  const plotWidth = W - PAD.left - PAD.right;

  const indexFromEvent = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    // The SVG scales to its container, so map client x back into viewBox units.
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const t = (vx - PAD.left) / plotWidth;
    if (t < 0 || t > 1) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(t * n)));
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

function IntervalChart({ cube, series, frame, onFrameSelect }: ChartProps) {
  const H = 156;
  const n = cube.nFrames;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / n;
  const barW = Math.min(24, Math.max(1, slot - GAP));
  const max = niceMax(Math.max(...series.interval));
  const ticks = useDayTicks(cube);
  const { index, handlers } = useHover(n, onFrameSelect);

  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const active = index ?? frame;

  return (
    <figure className="chart">
      <figcaption className="chart__title">
        Rainfall per forecast interval <span className="chart__unit">mm</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-label={`Rainfall per interval, peak ${mm(Math.max(...series.interval))} millimetres`}
        {...handlers}
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className="grid"
            />
            <text x={PAD.left - 6} y={y(v) + 3.5} className="axis axis--y">
              {v === 0 ? "0" : mm(v)}
            </text>
          </g>
        ))}

        <rect
          x={PAD.left + active * slot}
          y={PAD.top}
          width={Math.max(slot, 2)}
          height={plotH}
          className="chart__cursor"
        />

        {Array.from({ length: n }, (_, i) => {
          const v = series.interval[i]!;
          if (v <= 0) return null;
          const h = Math.max(1.5, ((v / max) * plotH));
          return (
            <rect
              key={i}
              x={PAD.left + i * slot + (slot - barW) / 2}
              y={PAD.top + plotH - h}
              width={barW}
              height={h}
              rx={Math.min(2, barW / 2)}
              fill={SERIES}
            />
          );
        })}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          className="baseline"
        />

        {ticks.map((t) => (
          <text
            key={t.i}
            x={PAD.left + t.i * slot}
            y={H - 6}
            className="axis axis--x"
          >
            {t.label}
          </text>
        ))}
      </svg>
      <Tooltip cube={cube} series={series} index={index} kind="interval" />
    </figure>
  );
}

function CumulativeChart({ cube, series, frame, onFrameSelect }: ChartProps) {
  const H = 126;
  const n = cube.nFrames;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = niceMax(series.total);
  const ticks = useDayTicks(cube);
  const { index, handlers } = useHover(n, onFrameSelect);

  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const line = series.cumulative
    .reduce<string[]>((acc, v, i) => {
      acc.push(`${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      return acc;
    }, [])
    .join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const active = index ?? frame;

  return (
    <figure className="chart">
      <figcaption className="chart__title">
        Cumulative rainfall <span className="chart__unit">mm</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-label={`Cumulative rainfall reaching ${mm(series.total)} millimetres`}
        {...handlers}
      >
        {[0, max].map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className="grid"
            />
            <text x={PAD.left - 6} y={y(v) + 3.5} className="axis axis--y">
              {v === 0 ? "0" : mm(v)}
            </text>
          </g>
        ))}

        <line
          x1={x(active)}
          x2={x(active)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          className="chart__crosshair"
        />

        <path d={area} fill={SERIES} fillOpacity={0.1} />
        <path
          d={line}
          fill="none"
          stroke={SERIES}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle
          cx={x(active)}
          cy={y(series.cumulative[active]!)}
          r={4}
          fill={SERIES}
          className="chart__dot"
        />

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          className="baseline"
        />

        {ticks.map((t) => (
          <text key={t.i} x={x(t.i)} y={H - 6} className="axis axis--x">
            {t.label}
          </text>
        ))}
      </svg>
      <Tooltip cube={cube} series={series} index={index} kind="cumulative" />
    </figure>
  );
}

function Tooltip({
  cube,
  series,
  index,
  kind,
}: {
  cube: Cube;
  series: PointSeries;
  index: number | null;
  kind: "interval" | "cumulative";
}) {
  if (index === null) return <p className="tip tip--placeholder">&nbsp;</p>;
  const f = cube.meta.frames[index]!;
  const value =
    kind === "interval"
      ? `${mm(series.interval[index]!)} mm in ${f.hours} h`
      : `${mm(series.cumulative[index]!)} mm so far`;
  return (
    <p className="tip" role="status">
      <span className="tip__key" style={{ background: SERIES }} aria-hidden="true" />
      {formatIst(cube.validTimes[index]!)} · {leadTime(f.step_end)} · <b>{value}</b>
    </p>
  );
}
