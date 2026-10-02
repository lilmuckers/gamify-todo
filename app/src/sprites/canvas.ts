/** A random source in [0, 1), e.g. Math.random or a seeded generator. */
export type Rand = () => number;

/** A fresh canvas set up for pixel art (no smoothing when drawing images). */
export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** One of `xs`, chosen by `r`. */
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
