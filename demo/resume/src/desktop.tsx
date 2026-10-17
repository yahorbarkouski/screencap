import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Browser, Claude, Glow, Notes, Terminal, withAlpha } from "./apps";
import { Rect, screen } from "./layout";
import { ink, ui } from "./theme";

export type WinID = "claude" | "browser" | "terminal" | "notes";

/**
 * Where each window sits, in points on the demo's screen. The three places of the tokenizer thread are laid out
 * side by side so each is plain to see; Notes, the trip's window, sits over the terminal, which is what hides the
 * terminal while the trip is in front. Resuming never moves or resizes a window, so these never change.
 */
export const frames: Record<WinID, Rect> = {
  claude: { x: 12, y: 34, width: 520, height: 594 },
  browser: { x: 540, y: 34, width: 472, height: 360 },
  terminal: { x: 540, y: 402, width: 472, height: 226 },
  notes: { x: 560, y: 330, width: 440, height: 290 },
};

export const appOf: Record<WinID, { name: string; bundle: string }> = {
  claude: { name: "Claude", bundle: "com.anthropic.claudefordesktop" },
  browser: { name: "Dia", bundle: "company.thebrowser.dia" },
  terminal: { name: "Ghostty", bundle: "com.mitchellh.ghostty" },
  notes: { name: "Notes", bundle: "com.apple.Notes" },
};

export const icon = (bundle: string) => staticFile(`generated/icons/${bundle}.png`);

export type DesktopState = {
  /** Back to front. */
  order: WinID[];
  tab: number;
  session: string;
  sidebarScroll: number;
  /** Windows, or their chosen tab or session, ringed in a thread's colour. */
  glow?: Partial<Record<WinID, Glow>>;
  /** Mission Control, 0 closed to 1 open, and the window the pointer is over in it. */
  mission?: number;
  missionHover?: WinID;
  clock?: string;
};

/** Mission Control's layout: the four windows shrunk into a grid, each with its app's name under it. */
const missionSlots: Record<WinID, Rect> = {
  claude: { x: 70, y: 84, width: 300, height: 343 },
  browser: { x: 410, y: 84, width: 300, height: 229 },
  notes: { x: 750, y: 84, width: 220, height: 145 },
  terminal: { x: 410, y: 380, width: 300, height: 144 },
};

export function Desktop({ state }: { state: DesktopState }) {
  const front = state.order[state.order.length - 1];
  const mission = state.mission ?? 0;
  return (
    <AbsoluteFill style={{ fontFamily: ui, overflow: "hidden", width: screen.width, height: screen.height }}>
      <Wallpaper />
      {mission > 0 && <AbsoluteFill style={{ background: `rgba(6,8,16,${0.5 * mission})` }} />}
      {state.order.map((id) => (
        <WindowAt key={id} id={id} active={id === front && mission === 0} state={state} mission={mission} />
      ))}
      <MenuBar app={appOf[front].name} clock={state.clock ?? "14:12"} />
    </AbsoluteFill>
  );
}

function WindowAt({ id, active, state, mission }: { id: WinID; active: boolean; state: DesktopState; mission: number }) {
  const f = frames[id];
  const slot = missionSlots[id];
  const scale = 1 + (slot.width / f.width - 1) * mission;
  const x = f.x + (slot.x - f.x) * mission;
  const y = f.y + (slot.y - f.y) * mission;
  const glow = state.glow?.[id];
  const hovered = state.missionHover === id;
  // Claude's and the browser's glow rings the session or tab that belongs to the thread; the others ring the window.
  const ringsWindow = id === "terminal" || id === "notes";
  const shadow = [
    active ? "0 18px 50px rgba(0,0,0,0.55)" : "0 10px 30px rgba(0,0,0,0.4)",
    "inset 0 0 0 1px rgba(255,255,255,0.10)",
    ringsWindow && glow && glow.strength > 0 ? `0 0 0 2px ${withAlpha(glow.color, glow.strength)}` : "",
    hovered ? "0 0 0 4px rgba(66,140,255,0.95)" : "",
  ].filter(Boolean);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: f.width, height: f.height, transformOrigin: "0 0", transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 12, overflow: "hidden", boxShadow: shadow.join(", ") }}>
        {id === "browser" && <Browser tab={state.tab} active={active} glow={glow} />}
        {id === "claude" && <Claude session={state.session} scroll={state.sidebarScroll} active={active} glow={glow} />}
        {id === "terminal" && <Terminal active={active} />}
        {id === "notes" && <Notes active={active} />}
      </div>
      {mission > 0.6 && (
        <div style={{ position: "absolute", top: f.height + 10 / scale, width: f.width, textAlign: "center", fontSize: 13 / scale, color: ink.text, opacity: (mission - 0.6) / 0.4 }}>
          {appOf[id].name}
        </div>
      )}
    </div>
  );
}

/** A plain, dark desktop, a step lighter than the backdrop around the screen. */
function Wallpaper() {
  return (
    <AbsoluteFill
      style={{
        background: [
          "radial-gradient(60% 60% at 12% 8%, rgba(99,102,241,0.26), transparent 70%)",
          "radial-gradient(60% 60% at 92% 96%, rgba(20,184,166,0.20), transparent 70%)",
          "linear-gradient(170deg, #14162a 0%, #101120 60%, #0c1418 100%)",
        ].join(", "),
      }}
    />
  );
}

/** The menu bar, with Screencap's glyph among the others on the right. */
function MenuBar({ app, clock }: { app: string; clock: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: screen.menuBar,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 18,
        fontSize: 13,
        color: ink.text,
        background: "rgba(20,22,36,0.55)",
      }}
    >
      <span style={{ fontSize: 14 }}>{""}</span>
      <span style={{ fontWeight: 700 }}>{app}</span>
      {["File", "Edit", "View", "Window", "Help"].map((m) => (
        <span key={m}>{m}</span>
      ))}
      <div style={{ flex: 1 }} />
      <Strip />
      <span>Tue 14 Oct</span>
      <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 36 }}>{clock}</span>
    </div>
  );
}

function Strip() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        height: 18,
        padding: "0 6px",
        margin: "0 -6px",
        borderRadius: 5,
      }}
    >
      {[6, 4, 0, 6].map((w, i) =>
        w === 0 ? (
          <div key={i} style={{ width: 2, height: 14, borderRadius: 1, background: "white" }} />
        ) : (
          <div key={i} style={{ width: w, height: 8, borderRadius: 2, background: "rgba(255,255,255,0.9)" }} />
        ),
      )}
    </div>
  );
}

export function AppIcon({ bundle, size }: { bundle: string; size: number }) {
  return <Img src={icon(bundle)} style={{ width: size, height: size, flex: "none" }} />;
}
