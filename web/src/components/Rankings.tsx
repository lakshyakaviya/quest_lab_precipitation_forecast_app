import { useMemo, useState } from "react";

import type { Cube } from "../lib/cube";
import { placeOutlooks, type PlaceOutlook } from "../lib/cube";
import { PLACES } from "../data/cities";
import { mm, mmValue } from "../lib/format";

const WINDOW_HOURS = 120; // the next five days
const TOP_N = 8;

type Board = "wettest" | "disagreement";

interface Props {
  cube: Cube;
  aiCube: Cube | null;
  now: Date;
  onPick: (point: { lat: number; lon: number }) => void;
}

/**
 * Which places are in for the most rain over the next five days, and which ones the
 * two models most disagree about.
 *
 * The disagreement board is the one worth having: it is the fastest way to find a
 * place where the physics and AI forecasts tell genuinely different stories, which is
 * otherwise something you have to hunt for by dragging the swipe around.
 */
export function Rankings({ cube, aiCube, now, onPick }: Props) {
  const [board, setBoard] = useState<Board>("wettest");

  const outlooks = useMemo(
    () => placeOutlooks(PLACES, cube, aiCube, now, WINDOW_HOURS),
    [cube, aiCube, now],
  );

  const rows = useMemo(() => {
    const copy = [...outlooks];
    if (board === "disagreement" && aiCube) {
      // Rank on the rounded figures, so a row never claims a gap the numbers beside
      // it do not show.
      copy.sort(
        (a, b) =>
          Math.abs(mmValue(b.physicsMm) - mmValue(b.aiMm ?? 0)) -
          Math.abs(mmValue(a.physicsMm) - mmValue(a.aiMm ?? 0)),
      );
    } else {
      copy.sort((a, b) => b.physicsMm - a.physicsMm);
    }
    return copy.slice(0, TOP_N);
  }, [outlooks, board, aiCube]);

  const maxBar = Math.max(
    1,
    ...rows.map((r) =>
      board === "disagreement"
        ? Math.abs(mmValue(r.physicsMm) - mmValue(r.aiMm ?? 0))
        : r.physicsMm,
    ),
  );

  const allDry = rows.every((r) => mmValue(r.physicsMm) === 0 && mmValue(r.aiMm ?? 0) === 0);

  return (
    <section className="ranks" aria-label="Rankings over the next five days">
      <div className="ranks__head">
        <h2 className="panel__title">Next 5 days</h2>
        {aiCube && (
          <div className="ranks__tabs" role="group" aria-label="Ranking">
            <button
              type="button"
              className={board === "wettest" ? "is-active" : undefined}
              onClick={() => setBoard("wettest")}
              aria-pressed={board === "wettest"}
            >
              Wettest
            </button>
            <button
              type="button"
              className={board === "disagreement" ? "is-active" : undefined}
              onClick={() => setBoard("disagreement")}
              aria-pressed={board === "disagreement"}
            >
              Models differ
            </button>
          </div>
        )}
      </div>

      <p className="ranks__note">
        {board === "disagreement"
          ? "Where the physics and AI forecasts most disagree. Neither is ground truth."
          : "Total precipitation expected at each place, physics model."}
      </p>

      {allDry ? (
        <p className="ranks__empty">
          No meaningful rain at any of these places in the next five days.
        </p>
      ) : (
        <ol className="ranks__list">
          {rows.map((r, i) => (
            <Row
              key={r.name}
              place={r}
              index={i}
              board={board}
              maxBar={maxBar}
              hasAi={aiCube !== null}
              onPick={onPick}
            />
          ))}
        </ol>
      )}

      <p className="ranks__hint">
        Pick a place, or click anywhere on the map, for its full timeline.
      </p>
    </section>
  );
}

function Row({
  place,
  index,
  board,
  maxBar,
  hasAi,
  onPick,
}: {
  place: PlaceOutlook;
  index: number;
  board: Board;
  maxBar: number;
  hasAi: boolean;
  onPick: (point: { lat: number; lon: number }) => void;
}) {
  const physics = mmValue(place.physicsMm);
  const ai = mmValue(place.aiMm ?? 0);
  const diff = physics - ai;
  const value = board === "disagreement" ? Math.abs(diff) : physics;
  const width = `${Math.max(2, (value / maxBar) * 100)}%`;

  return (
    <li className="ranks__row">
      <button type="button" onClick={() => onPick({ lat: place.lat, lon: place.lon })}>
        <span className="ranks__pos">{index + 1}</span>
        <span className="ranks__name">
          {place.name}
          <span className="ranks__state">{place.state}</span>
        </span>
        <span className="ranks__bars" aria-hidden="true">
          <span
            className={
              board === "disagreement" && diff < 0
                ? "ranks__bar ranks__bar--ai"
                : "ranks__bar"
            }
            style={{ width }}
          />
        </span>
        <span className="ranks__value">
          {board === "disagreement" && hasAi ? (
            <>
              {mm(physics)}
              <span className="ranks__vs"> vs </span>
              {mm(ai)}
              <span className="ranks__unit"> mm</span>
            </>
          ) : (
            <>
              {mm(physics)}
              <span className="ranks__unit"> mm</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}
