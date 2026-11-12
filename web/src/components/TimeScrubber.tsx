import type { Cube } from "../lib/cube";
import { formatIst, formatUtc, leadTime } from "../lib/format";

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

interface Props {
  cube: Cube;
  frame: number;
  playing: boolean;
  speed: Speed;
  onFrame: (frame: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: Speed) => void;
  /** So the app can reserve this bar's height when it is fixed to the bottom. */
  ref?: React.Ref<HTMLDivElement>;
}

export function TimeScrubber({
  cube,
  frame,
  playing,
  speed,
  onFrame,
  onTogglePlay,
  onSpeed,
  ref,
}: Props) {
  const meta = cube.meta.frames[frame]!;
  const validAt = cube.validTimes[frame]!;
  const last = cube.nFrames - 1;

  // A tick at each IST midnight, so the track reads as days rather than step numbers.
  const IST_OFFSET_MS = 5.5 * 3_600_000;
  const dayTicks = cube.validTimes
    .map((t, i) => ({ i, istHour: new Date(t.getTime() + IST_OFFSET_MS).getUTCHours() }))
    .filter(({ istHour }) => istHour === 0)
    .map(({ i }) => i);

  return (
    <section className="scrubber" aria-label="Forecast time" ref={ref}>
      <button
        type="button"
        className="scrubber__play"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause animation" : "Play animation"}
        aria-pressed={playing}
      >
        <span aria-hidden="true">{playing ? "‖" : "▶"}</span>
      </button>

      <div className="scrubber__track">
        <div className="scrubber__labels">
          <span className="scrubber__valid">{formatIst(validAt)} IST</span>
          <span className="scrubber__lead">
            {leadTime(meta.step_end)} · {meta.hours} h accumulation ·{" "}
            {formatUtc(validAt)}
          </span>
        </div>
        <div className="scrubber__slider">
          <div className="scrubber__ticks" aria-hidden="true">
            {dayTicks.map((i) => (
              <span
                key={i}
                className="scrubber__tick"
                style={{ left: `${(i / last) * 100}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={last}
            step={1}
            value={frame}
            onChange={(e) => onFrame(Number(e.target.value))}
            aria-label="Forecast time step"
            aria-valuetext={`${formatIst(validAt)} India Standard Time, ${leadTime(meta.step_end)}`}
          />
        </div>
      </div>

      <div className="scrubber__speed" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={s === speed ? "is-active" : undefined}
            onClick={() => onSpeed(s)}
            aria-pressed={s === speed}
          >
            {s}&times;
          </button>
        ))}
      </div>
    </section>
  );
}
