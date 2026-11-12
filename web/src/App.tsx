import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Cube, loadData, type PointSeries } from "./lib/cube";
import { MapView, type SelectedPoint } from "./map/MapView";
import { PointPanel } from "./components/PointPanel";
import { TimeScrubber, type Speed } from "./components/TimeScrubber";
import { Legend } from "./components/Legend";
import { AttributionBar } from "./components/AttributionBar";

/** Milliseconds per forecast frame at 1x. Slow enough to read, fast enough to feel. */
const FRAME_MS = 320;

export default function App() {
  const [cube, setCube] = useState<Cube | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [selected, setSelected] = useState<SelectedPoint | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal)
      .then(({ cube: loaded }) => setCube(loaded))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, []);

  // Playback. A timer rather than requestAnimationFrame: frames are discrete forecast
  // steps, so advancing them on a fixed cadence is the honest representation.
  const lastFrameRef = useRef(0);
  useEffect(() => {
    if (!cube || !playing) return;
    lastFrameRef.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const due = FRAME_MS / speed;
      if (now - lastFrameRef.current >= due) {
        lastFrameRef.current = now;
        setFrame((f) => (f + 1) % cube.nFrames);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cube, playing, speed]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  const stepFrame = useCallback(
    (delta: number) => {
      if (!cube) return;
      setPlaying(false);
      setFrame((f) => Math.max(0, Math.min(cube.nFrames - 1, f + delta)));
    },
    [cube],
  );

  // Keyboard control works wherever focus is, except inside a text field.
  useEffect(() => {
    if (!cube) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          stepFrame(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepFrame(-1);
          break;
        case "Home":
          e.preventDefault();
          setPlaying(false);
          setFrame(0);
          break;
        case "End":
          e.preventDefault();
          setPlaying(false);
          setFrame(cube.nFrames - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cube, stepFrame, togglePlay]);

  const series: PointSeries | null = useMemo(() => {
    if (!cube || !selected) return null;
    return cube.seriesAt(selected.lat, selected.lon);
  }, [cube, selected]);

  const onFrameSelect = useCallback((f: number) => {
    setPlaying(false);
    setFrame(f);
  }, []);

  // On narrow screens the scrubber is a fixed bottom bar, so the page must reserve
  // exactly its height or the last line of the attribution stays stuck underneath.
  // Measured rather than hardcoded: the bar's height changes with the safe-area
  // inset and the user's font size.
  const scrubberRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrubberRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty(
        "--scrubber-h",
        `${Math.ceil(el.getBoundingClientRect().height)}px`,
      );
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cube]);

  if (error) {
    return (
      <main className="state state--error">
        <h1>Monsoon Lens</h1>
        <p>Could not load the forecast.</p>
        <p className="state__detail">{error}</p>
        <p className="state__hint">
          The pipeline publishes a new forecast twice a day; if this persists the latest
          run may still be building.
        </p>
      </main>
    );
  }

  if (!cube) {
    return (
      <main className="state">
        <h1>Monsoon Lens</h1>
        <p>Loading the forecast…</p>
      </main>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          Monsoon Lens
          <span className="topbar__sub">
            Ten-day rainfall forecast for India
          </span>
        </h1>
        <Legend />
      </header>

      <div className="app__body">
        <MapView
          cube={cube}
          frame={frame}
          playing={playing}
          selected={selected}
          onSelect={setSelected}
        />
        <PointPanel
          cube={cube}
          series={series}
          frame={frame}
          onFrameSelect={onFrameSelect}
          onClear={() => setSelected(null)}
        />
      </div>

      <TimeScrubber
        ref={scrubberRef}
        cube={cube}
        frame={frame}
        playing={playing}
        speed={speed}
        onFrame={onFrameSelect}
        onTogglePlay={togglePlay}
        onSpeed={setSpeed}
      />
      <AttributionBar cube={cube} />
    </div>
  );
}
