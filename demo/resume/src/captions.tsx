import React from "react";
import { captionArea, canvas } from "./layout";
import { display, ink, ui } from "./theme";

// The caption under the screen: one short line, set as Screencap sets its own day headline, in its weight and
// tracking. A key named in a caption is drawn as the palette draws its keys, and lights up while it is pressed.
// Everything else is left for the screen to show.

/** `{⌥}{Space}` in a caption is a keycap. */
const parts = (text: string) => text.split(/(\{[^}]+\})/).filter(Boolean);

function Keycap({ label, pressed }: { label: string; pressed: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 54,
        height: 54,
        padding: "0 16px",
        margin: "0 5px",
        boxSizing: "border-box",
        borderRadius: 12,
        background: `rgba(255,255,255,${0.08 + 0.22 * pressed})`,
        boxShadow: `inset 0 0 0 1px rgba(255,255,255,${0.16 + 0.2 * pressed})`,
        color: pressed > 0.5 ? ink.text : ink.secondary,
        fontFamily: ui,
        fontSize: 32,
        fontWeight: 500,
        letterSpacing: 0,
        verticalAlign: "6px",
        transform: `translateY(${pressed * 1.5}px)`,
      }}
    >
      {label}
    </span>
  );
}

export function Caption(props: { text: string; opacity: number; pressedKey: (label: string) => number }) {
  const { text, opacity, pressedKey } = props;
  if (opacity <= 0) return null;
  return (
    <div style={{ position: "absolute", left: 0, top: captionArea.y, width: canvas.width, textAlign: "center", opacity, transform: `translateY(${(1 - opacity) * 4}px)` }}>
      <div style={{ fontFamily: display, fontSize: 50, lineHeight: "60px", fontWeight: 500, letterSpacing: -1, color: ink.text, whiteSpace: "nowrap" }}>
        {parts(text).map((p, i) =>
          p.startsWith("{") ? <Keycap key={i} label={p.slice(1, -1)} pressed={pressedKey(p.slice(1, -1))} /> : <span key={i}>{p}</span>,
        )}
      </div>
    </div>
  );
}
