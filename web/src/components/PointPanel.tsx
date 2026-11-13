import { useMemo, useState } from "react";

import type { Cube, PointSeries } from "../lib/cube";
import {
  coords,
  formatIst,
  formatIstDay,
  leadTime,
  mm,
  rate as fmtRate,
  relativeTo,
} from "../lib/format";

const SERIES = "#3987e5"; // blue, categorical slot 1 (dark steps)
const PAST_OPACITY = 0.26;

interface Props {
  cube: Cube;
  series: PointSeries | null;
  frame: number;
  now: Date;
  onFrameSelect: (frame: number) => void;
  onClear: () => void;
}

/**
 * Rainfall at one grid cell.
 *
 * Interval rainfall and cumulative rainfall are two measures on different scales, so
 * they get **two charts** rather than one chart with two y-axes. Each has a single
 * series, so neither needs a legend: the chart's own title names what is plotted.
 *
 * Everything forward-looking is measured from the present, not from the forecast run,
 * and elapsed intervals are drawn dimmed behind a "now" marker.
 */
export function PointPanel({
  cube,
  series,
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
          forecast.
        </p>
      </aside>
    );
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
          expected from now to {formatIstDay(endTime)}
          {series.remainingTotal < series.total - 0.05 && (
            <> · {mm(series.total)} mm over the whole run</>
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

      <IntervalChart
        cube={cube}
        series={series}
        frame={frame}
        now={now}
        onFrameSelect={onFrameSelect}
      />
      <CumulativeChart
        cube={cube}
        series={series}
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
        </div>
      </details>
    </aside>
  );
}

// --------------------------------------------------------------------------------------
// Charts
// --------------------------------------------------------------------------------------

const W = 560;
const PAD = { top: 14, right: 10, bottom: 22, left: 40 };
const GAP = 2; // the surface gap that separates adjacent bars

interface ChartProps {
  cube: Cube;
  series: PointSeries;
  frame: number;
  now: Date;
  onFrameSelect: (frame: number) => void;
}

/** Ticks at IST midnight, so the x axis reads as days rather than step numbers. */
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

/**
 * Shared geometry. The x axis is **linear in lead time**, not in frame index.
 *
 * That matters because the forecast is 3-hourly out to T+144h and 6-hourly after. On a
 * frame-index axis the later half of the forecast is stretched to twice its real
 * duration, which is what made 6-hourly bars look like twice as much rain.
 */
function useScale(cube: Cube, now: Date) {
  const plotW = W - PAD.left - PAD.right;
  const x = (lead: number) => PAD.left + (lead / cube.maxLead) * plotW;
  const nowLead = Math.max(0, Math.min(cube.maxLead, cube.leadHoursAt(now)));
  return { plotW, x, nowLead };
}

function useHover(cube: Cube, onFrameSelect: (frame: number) => void) {
  const [index, setIndex] = useState<number | null>(null);
  const plotW = W - PAD.left - PAD.right;

  const indexFromEvent = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    // The SVG scales to its container, so map client x back into viewBox units.
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

function IntervalChart({ cube, series, frame, now, onFrameSelect }: ChartProps) {
  const H = 156;
  const plotH = H - PAD.top - PAD.bottom;
  const { x, nowLead } = useScale(cube, now);
  const ticks = useDayTicks(cube);
  const { index, handlers } = useHover(cube, onFrameSelect);

  // Height is rate, width is the interval's real duration, so each bar's AREA is the
  // millimetres that fall in it. A 6-hourly bar at the same rate is twice as wide
  // rather than twice as tall.
  const maxRate = niceMax(Math.max(...series.rate));
  const y = (v: number) => PAD.top + plotH - (v / maxRate) * plotH;
  const active = index ?? frame;

  return (
    <figure className="chart">
      <figcaption className="chart__title">
        Rainfall rate <span className="chart__unit">mm/h</span>
        <span className="chart__note">
          bar width is the forecast interval — 3 h, then 6 h after day 6
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart__svg"
        role="img"
        aria-label={`Rainfall rate, peaking at ${fmtRate(series.peakRate)} millimetres per hour`}
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
          x={x(cube.stepStart[active]!)}
          y={PAD.top}
          width={Math.max(2, x(cube.stepEnd[active]!) - x(cube.stepStart[active]!))}
          height={plotH}
          className="chart__cursor"
        />

        {Array.from({ length: cube.nFrames }, (_, i) => {
          const v = series.rate[i]!;
          if (v <= 0) return null;
          const x0 = x(cube.stepStart[i]!);
          const x1 = x(cube.stepEnd[i]!);
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
              fill={SERIES}
              opacity={cube.isPast(i, now) ? PAST_OPACITY : 1}
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

        {nowLead > 0 && nowLead < cube.maxLead && (
          <NowMarker x={x(nowLead)} top={PAD.top} height={plotH} />
        )}

        {ticks.map((t) => (
          <text key={t.lead} x={x(t.lead)} y={H - 6} className="axis axis--x">
            {t.label}
          </text>
        ))}
      </svg>
      <Tooltip cube={cube} series={series} index={index} kind="interval" />
    </figure>
  );
}

function CumulativeChart({ cube, series, frame, now, onFrameSelect }: ChartProps) {
  const H = 126;
  const plotH = H - PAD.top - PAD.bottom;
  const { x, nowLead } = useScale(cube, now);
  const ticks = useDayTicks(cube);
  const { index, handlers } = useHover(cube, onFrameSelect);

  const max = niceMax(series.total);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const point = (i: number) =>
    `${x(cube.stepEnd[i]!).toFixed(1)},${y(series.cumulative[i]!).toFixed(1)}`;

  const path = (from: number, to: number) => {
    if (to <= from) return "";
    const parts: string[] = [];
    for (let i = from; i <= to; i++) {
      parts.push(`${i === from ? "M" : "L"}${point(i)}`);
    }
    return parts.join(" ");
  };

  const split = series.fromFrame;
  const pastPath = path(0, split);
  const futurePath = path(split, cube.nFrames - 1);
  const area = `${path(0, cube.nFrames - 1)} L${x(cube.maxLead).toFixed(1)},${y(0).toFixed(1)} L${x(cube.stepEnd[0]!).toFixed(1)},${y(0).toFixed(1)} Z`;

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
        aria-label={`Cumulative rainfall reaching ${mm(series.total)} millimetres`}
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
          x1={x(cube.stepEnd[active]!)}
          x2={x(cube.stepEnd[active]!)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          className="chart__crosshair"
        />

        <path d={area} fill={SERIES} fillOpacity={0.08} />
        {pastPath && (
          <path
            d={pastPath}
            fill="none"
            stroke={SERIES}
            strokeOpacity={PAST_OPACITY}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {futurePath && (
          <path
            d={futurePath}
            fill="none"
            stroke={SERIES}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        <circle
          cx={x(cube.stepEnd[active]!)}
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

        {nowLead > 0 && nowLead < cube.maxLead && (
          <NowMarker x={x(nowLead)} top={PAD.top} height={plotH} />
        )}

        {ticks.map((t) => (
          <text key={t.lead} x={x(t.lead)} y={H - 6} className="axis axis--x">
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
      ? `${fmtRate(series.rate[index]!)} mm/h — ${mm(series.interval[index]!)} mm over ${f.hours} h`
      : `${mm(series.cumulative[index]!)} mm so far`;
  return (
    <p className="tip" role="status">
      <span className="tip__key" style={{ background: SERIES }} aria-hidden="true" />
      {formatIst(cube.validTimes[index]!)} · {leadTime(f.step_end)} · <b>{value}</b>
    </p>
  );
}
