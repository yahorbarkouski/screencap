import React from "react";
import { Img, staticFile } from "remotion";
import { screen } from "./layout";
import { mark } from "./theme";
import { ramp } from "./timeline";

// What is drawn on the demo's screen over its windows, in the screen's own points: the pointer and its clicks,
// the Resume palette.

export function Cursor({ x, y, pressed = 0, opacity = 1 }: { x: number; y: number; pressed?: number; opacity?: number }) {
  if (opacity <= 0) return null;
  return (
    <svg
      width={18}
      height={26}
      viewBox="0 0 22 32"
      style={{ position: "absolute", left: x - 2.5, top: y - 1.5, opacity, transform: `scale(${1 - pressed * 0.12})`, transformOrigin: "2.5px 1.5px", filter: "drop-shadow(0 1.5px 2px rgba(0,0,0,0.5))" }}
    >
      <path d="M3 2 L3 25 L8.5 19.8 L12.4 28.6 L16 27 L12.2 18.4 L19.6 18.2 Z" fill="black" stroke="white" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

/** A click, shown as a ring that spreads from the pointer and fades, so every step of the way back can be seen. */
export function Ripple({ t, at, x, y }: { t: number; at: number; x: number; y: number }) {
  const p = ramp(t, at, at + 0.4);
  if (t < at || p >= 1) return null;
  const r = 6 + 16 * p;
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: 2 * r,
        height: 2 * r,
        borderRadius: r,
        boxShadow: `inset 0 0 0 2px rgba(255,255,255,${0.75 * (1 - p)})`,
        background: `rgba(255,255,255,${0.12 * (1 - p)})`,
      }}
    />
  );
}

export const palette = { width: 880, height: 512, x: (screen.width - 880) / 2, y: 60 };

/** The palette as the app drew it (`Screencap resume-story`), over the same glass the app gives it. */
export function Palette({ state, open }: { state: string; open: number }) {
  if (open <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: palette.x,
        top: palette.y,
        width: palette.width,
        height: palette.height,
        borderRadius: 20,
        overflow: "hidden",
        opacity: open,
        transform: `scale(${0.98 + 0.02 * open})`,
        background: "rgba(30,32,46,0.66)",
        backdropFilter: "blur(40px) saturate(1.7)",
        // The palette draws its own hairline edge, as in the app; the glass adds only its top light and its shadow.
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 30px 80px rgba(0,0,0,0.55)",
      }}
    >
      <Img src={staticFile(`generated/palette/palette-${state}.png`)} style={{ width: palette.width, height: palette.height }} />
    </div>
  );
}

export const threadColors = mark;
