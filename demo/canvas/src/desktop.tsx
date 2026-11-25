import React from "react";
import { AbsoluteFill } from "remotion";
import { ink, ui } from "../../resume/src/theme";
import { apps, PlaceID, places, screen } from "./day";
import { Window } from "./screens";

/** The Mac of the made-up day: one window at a time, and the clock. */
export function Desktop({ place, index, clock }: { place: PlaceID; index: number; clock: string }) {
  const w = screen.window;
  return (
    <AbsoluteFill style={{ width: screen.width, height: screen.height, overflow: "hidden", fontFamily: ui }}>
      <AbsoluteFill
        style={{
          background: [
            "radial-gradient(60% 60% at 12% 8%, rgba(99,102,241,0.26), transparent 70%)",
            "radial-gradient(60% 60% at 92% 96%, rgba(20,184,166,0.20), transparent 70%)",
            "linear-gradient(170deg, #14162a 0%, #101120 60%, #0c1418 100%)",
          ].join(", "),
        }}
      />
      <div style={{ position: "absolute", left: w.x, top: w.y, width: w.width, height: w.height, borderRadius: 12, overflow: "hidden", boxShadow: "0 18px 50px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.1)" }}>
        <Window place={place} index={index} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 25, display: "flex", alignItems: "center", padding: "0 14px", gap: 18, fontSize: 13.5, color: ink.text, background: "rgba(20,22,36,0.55)" }}>
        <span style={{ fontWeight: 700 }}>{apps[places[place].app].name}</span>
        {["File", "Edit", "View", "Window", "Help"].map((m) => (
          <span key={m}>{m}</span>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{clock}</span>
      </div>
    </AbsoluteFill>
  );
}
