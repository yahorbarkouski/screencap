import { Easing, interpolate } from "remotion";

export const fps = 30;

/** A value that moves between keyframes: `[seconds, value]` pairs, eased in and out between neighbours. */
export function ease(t: number, points: [number, number][], easing = Easing.bezier(0.33, 0, 0.2, 1)): number {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    const [t0, v0] = points[i - 1];
    if (t <= t1) return interpolate(t, [t0, t1], [v0, v1], { easing });
  }
  return points[points.length - 1][1];
}

/** A value that changes at moments and holds in between: the last `[seconds, value]` at or before `t`. */
export function step<T>(t: number, points: [number, T][]): T {
  let value = points[0][1];
  for (const [at, v] of points) if (t >= at) value = v;
  return value;
}

/** 0 before `start`, 1 after `end`, eased between. */
export function ramp(t: number, start: number, end: number): number {
  return interpolate(t, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  });
}

/** Shown from `start` to `end`, fading over `fade` seconds at each side. */
export function window(t: number, start: number, end: number, fade = 0.18): number {
  return Math.min(ramp(t, start, start + fade), 1 - ramp(t, end - fade, end));
}
