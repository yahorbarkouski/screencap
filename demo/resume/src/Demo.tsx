import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Caption } from "./captions";
import { Desktop } from "./desktop";
import { canvas, scale, screen, viewport } from "./layout";
import { Cursor, Palette, Ripple } from "./scene";
import * as script from "./script";
import { backdrop } from "./theme";
import { fps, window } from "./timeline";

export const duration = script.duration;
export const frameSize = canvas;

/** Where the screen's layer sits so that the camera's centre is in the middle of the frame, never past an edge. */
function cameraTransform(t: number) {
  const { x, y, zoom } = script.cameraAt(t);
  const s = scale * zoom;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const tx = clamp(viewport.width / 2 - x * s, viewport.width - screen.width * s, 0);
  const ty = clamp(viewport.height / 2 - y * s, viewport.height - screen.height * s, 0);
  return `translate(${tx}px, ${ty}px) scale(${s})`;
}

export function Demo() {
  const t = useCurrentFrame() / fps;
  const desktop = script.desktopAt(t);
  const cursor = script.cursorAt(t);
  const palette = script.paletteAt(t);
  const caption = script.captions.find((c) => t >= c.from && t < c.to);

  return (
    <AbsoluteFill style={{ background: backdrop }}>
      <div
        style={{
          position: "absolute",
          left: viewport.x,
          top: viewport.y,
          width: viewport.width,
          height: viewport.height,
          borderRadius: viewport.radius,
          overflow: "hidden",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.10), 0 30px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: screen.width, height: screen.height, transformOrigin: "0 0", transform: cameraTransform(t) }}>
          <Desktop state={desktop} />
          <Palette state={palette.state} open={palette.open} />
          {script.clicks.map((at) => {
            const where = script.cursorAt(at);
            return <Ripple key={at} t={t} at={at} x={where.x} y={where.y} />;
          })}
          <Cursor {...cursor} />
        </div>
        <AbsoluteFill style={{ background: "black", opacity: script.dipAt(t) }} />
      </div>

      {caption && (
        <Caption text={caption.text} opacity={window(t, caption.from, caption.to, 0.16)} pressedKey={script.pressedAt(t)} />
      )}
    </AbsoluteFill>
  );
}
