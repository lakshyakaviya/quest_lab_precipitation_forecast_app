/**
 * Draws the rain field onto the map.
 *
 * Implementation is deliberately the simplest thing that is correct: the cube frame is
 * coloured into a 141x141 `ImageData` and handed to MapLibre as a `canvas` source,
 * which uploads it as a texture and reprojects it like any raster layer. Bilinear
 * resampling smooths the 0.25 degree cells.
 *
 * `RainSurface` is the seam. A later WebGL implementation — one 3D texture over the
 * whole cube, sampled with trilinear filtering for continuous sub-step time
 * interpolation — can replace this class without the rest of the app changing.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { Cube } from "../lib/cube";
import { RAIN_SOURCE_ID } from "./basemapStyle";

export interface RainSurface {
  /** Show the field for a given frame index. */
  setFrame(frame: number): void;
  /** Keep uploading every rendered map frame (used while animating). */
  startAnimating(): void;
  /** Stop uploading, to leave the GPU idle while paused. */
  stopAnimating(): void;
  destroy(): void;
}

/** Minimal shape of MapLibre's CanvasSource that this layer relies on. */
interface CanvasSourceLike {
  play: () => void;
  pause: () => void;
}

export class CanvasRainSurface implements RainSurface {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly cube: Cube;
  private map: MapLibreMap | null = null;
  private animating = false;
  private pendingPause = 0;
  private currentFrame = -1;

  constructor(cube: Cube) {
    this.cube = cube;
    this.canvas = document.createElement("canvas");
    this.canvas.width = cube.nLon;
    this.canvas.height = cube.nLat;
    // Off-screen but still laid out: a `display: none` canvas can read back empty in
    // some engines, while an off-viewport one is always a valid bitmap source.
    this.canvas.style.position = "absolute";
    this.canvas.style.left = "-10000px";
    this.canvas.style.top = "0";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("could not get a 2D context for the rain canvas");
    this.ctx = ctx;
    this.image = ctx.createImageData(cube.nLon, cube.nLat);
  }

  /** Called once the map's style (and therefore the canvas source) exists. */
  attach(map: MapLibreMap): void {
    this.map = map;
    // The source starts animating; pause until something actually asks to animate.
    this.stopAnimating();
  }

  private source(): CanvasSourceLike | null {
    const src = this.map?.getSource(RAIN_SOURCE_ID) as
      | CanvasSourceLike
      | undefined;
    return src ?? null;
  }

  setFrame(frame: number): void {
    const clamped = Math.max(0, Math.min(this.cube.nFrames - 1, Math.round(frame)));
    if (clamped === this.currentFrame) return;
    this.currentFrame = clamped;

    this.cube.paintFrame(clamped, this.image.data);
    this.ctx.putImageData(this.image, 0, 0);

    if (!this.animating) this.uploadOnce();
  }

  /**
   * Push exactly one texture upload while paused.
   *
   * MapLibre's canvas source only re-reads the canvas on rendered frames, so a single
   * `play()` followed by a `pause()` on the next animation frame guarantees the new
   * pixels reach the GPU without leaving the map repainting forever.
   */
  private uploadOnce(): void {
    const src = this.source();
    if (!src) return;
    src.play();
    this.map?.triggerRepaint();
    if (this.pendingPause) cancelAnimationFrame(this.pendingPause);
    this.pendingPause = requestAnimationFrame(() => {
      this.pendingPause = requestAnimationFrame(() => {
        this.pendingPause = 0;
        if (!this.animating) this.source()?.pause();
      });
    });
  }

  startAnimating(): void {
    this.animating = true;
    if (this.pendingPause) {
      cancelAnimationFrame(this.pendingPause);
      this.pendingPause = 0;
    }
    this.source()?.play();
  }

  stopAnimating(): void {
    this.animating = false;
    this.source()?.pause();
  }

  destroy(): void {
    if (this.pendingPause) cancelAnimationFrame(this.pendingPause);
    this.canvas.remove();
    this.map = null;
  }
}
