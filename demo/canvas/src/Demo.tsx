import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { Caption } from "../../resume/src/captions";
import { canvas, viewport } from "../../resume/src/layout";
import { backdrop, ink, ui } from "../../resume/src/theme";
import { window } from "../../resume/src/timeline";
import { screen } from "./day";
import { mix } from "./screens/kit";
import * as script from "./script";

export const frameSize = canvas;
const scale = viewport.width / script.film.width;
const page = "#1e1e1e";
/** A screen's window, as the part of the screen it takes up. */
const front = {
  x: screen.window.x / screen.width,
  y: screen.window.y / screen.height,
  width: screen.window.width / screen.width,
  height: screen.window.height / screen.height,
};

export function Demo() {
  const t = useCurrentFrame() / script.fps;
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
        {t < script.acts.app && <Heap t={t} />}
        {t >= script.acts.app - 0.3 && (
          <Img
            src={staticFile(`generated/app/${String(script.filmFrame(t)).padStart(5, "0")}.png`)}
            style={{ position: "absolute", inset: 0, width: viewport.width, height: viewport.height, opacity: script.filmAt(t) }}
          />
        )}
      </div>
      {caption && <Caption text={caption.text} opacity={window(t, caption.from, caption.to, 0.16)} pressedKey={() => 0} />}
    </AbsoluteFill>
  );
}

/** The day's screens, dealt into a heap, and their flight to the canvas. */
function Heap({ t }: { t: number }) {
  const room = script.roomAt(t);
  return (
    <>
      <AbsoluteFill
        style={{
          background: [
            "radial-gradient(60% 60% at 12% 8%, rgba(99,102,241,0.30), transparent 70%)",
            "radial-gradient(60% 60% at 92% 96%, rgba(20,184,166,0.24), transparent 70%)",
            "linear-gradient(170deg, #14162a 0%, #101120 60%, #0c1418 100%)",
          ].join(", "),
        }}
      />
      <AbsoluteFill style={{ background: page, opacity: room }} />
      {room > 0 && (
        <div style={{ position: "absolute", left: 0, top: 0, width: viewport.width, height: script.film.bar * scale, overflow: "hidden", opacity: room }}>
          <Img src={staticFile("generated/app/00000.png")} style={{ width: viewport.width, height: viewport.height }} />
        </div>
      )}
      <AbsoluteFill style={{ filter: script.blurAt(t) > 0.05 ? `blur(${script.blurAt(t)}px)` : undefined }}>
        {/* What leads to a picture on the canvas lies over what folds into it. */}
        {script.cards.map((card, i) => <Dealt key={i} t={t} card={card} order={i} />)}
      </AbsoluteFill>
      <MenuBar clock={script.clockAt(t)} opacity={1 - room} />
    </>
  );
}

function Dealt({ t, card, order }: { t: number; card: script.Card; order: number }) {
  const in_ = script.landed(t, card);
  if (in_ <= 0) return null;
  const out = script.flown(t, card);
  const s = script.heapScale(t);
  const width = screen.window.width * s * mix(1.14, 1, in_), height = screen.window.height * s * mix(1.14, 1, in_);
  const heap = { x: viewport.width / 2 + card.x * s - width / 2, y: viewport.height / 2 + card.y * s - height / 2 - (1 - in_) * 40, width, height };
  const there = card.plate ? { x: card.plate.frame.x * scale, y: card.plate.frame.y * scale, width: card.plate.frame.width * scale, height: card.plate.frame.height * scale } : heap;
  const to = card.plate?.part ?? front;
  const f = { x: mix(heap.x, there.x, out), y: mix(heap.y, there.y, out), width: mix(heap.width, there.width, out), height: mix(heap.height, there.height, out) };
  const p = { x: mix(front.x, to.x, out), y: mix(front.y, to.y, out), width: mix(front.width, to.width, out), height: mix(front.height, to.height, out) };
  const fades = card.plate ? (card.leads ? 1 : 1 - Math.max(0, (out - 0.82) / 0.18)) : 1 - out;
  const image = { width: f.width / p.width, height: f.height / p.height };
  return (
    <div
      style={{
        position: "absolute",
        left: f.x,
        top: f.y,
        width: f.width,
        height: f.height,
        zIndex: card.leads && out > 0 ? 1000 + order : order,
        borderRadius: mix(14 * Math.max(0.5, s), (card.plate?.radius ?? 10) * scale, out),
        overflow: "hidden",
        opacity: Math.min(in_ * 2.6, fades, 1),
        transform: `rotate(${card.turn * (1 - out) * in_}deg)`,
        boxShadow: `0 ${18 * (1 - out)}px ${44 * (1 - out)}px rgba(0,0,0,${0.5 * (1 - out)}), inset 0 0 0 1px rgba(255,255,255,0.12)`,
      }}
    >
      <Img src={staticFile(`generated/${s > 0.75 ? "screens" : "small"}/${card.screen}.png`)} style={{ position: "absolute", maxWidth: "none", width: image.width, height: image.height, left: -p.x * image.width, top: -p.y * image.height }} />
    </div>
  );
}

/** The Mac's menu bar: the day's clock. */
function MenuBar({ clock, opacity }: { clock: string; opacity: number }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 38, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 20, padding: "0 22px", fontFamily: ui, fontSize: 21, fontWeight: 500, color: ink.text, background: "rgba(16,18,30,0.72)", opacity, zIndex: 3000 }}>
      <span style={{ color: ink.secondary }}>Thu 12 Nov</span>
      <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 58, textAlign: "right" }}>{clock}</span>
    </div>
  );
}
