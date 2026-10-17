import { sessionRow, tabIndex, tabRect } from "./apps";
import { DesktopState, frames, WinID } from "./desktop";
import { screen } from "./layout";
import { mark } from "./theme";
import { ease, ramp } from "./timeline";

// The demo's plot, in seconds from its start. It opens on what is going on and why it hurts, and only then shows
// Screencap, so nothing before Screencap's own palette can be taken for Screencap.
//
//   work     0.0   you are fixing a bug, with three places open for it: a Claude session, a pull request, a terminal
//   switch   2.8   you switch to planning a trip, and the same windows change to it, one by one
//   slow     5.4   later you want the bug fix back, and without Screencap it takes seven steps to find the three again
//   fast    15.4   the same moment with Screencap: ⌥Space, Tab shows what the bug fix had open, Return brings it back
//   any     23.5   the trip comes back the same way
//   end     27.8   the name

export const acts = { work: 0, switch: 2.8, slow: 5.4, fast: 15.4, any: 23.5, end: 27.8 };
export const duration = 30.5;

const { switch: S, slow: B, fast: C, any: D } = acts;

/* ---------- the screens each thread was left on ---------- */

/** The bug fix: Claude in front on its session, the pull request in the browser, the terminal beside it. */
export const tokenizerScreen: DesktopState = {
  order: ["notes", "terminal", "browser", "claude"],
  tab: tabIndex("pr"),
  session: "tokenizer",
  sidebarScroll: 140,
};

/** The trip: the browser on Gion, Claude on its own trip session, and Notes over the terminal. */
export const kyotoScreen: DesktopState = {
  order: ["terminal", "claude", "notes", "browser"],
  tab: tabIndex("gion"),
  session: "trips",
  sidebarScroll: 0,
};

/* ---------- what changes on screen ---------- */

type Change = { at: number; id: WinID; tab?: string; session?: string; scroll?: number; glow?: string; hold?: number };

/** The three places of the bug fix, ringed in its colour one by one while the first caption names them. */
const workRings: Change[] = [
  { at: 0.7, id: "claude", glow: mark.tokenizer, hold: S - 0.2 },
  { at: 1.2, id: "browser", glow: mark.tokenizer, hold: S - 0.2 },
  { at: 1.7, id: "terminal", glow: mark.tokenizer, hold: S - 0.2 },
];

/** The switch: Claude goes to the trip's session, Notes opens over the terminal, the browser goes to Gion. */
const switchChanges: Change[] = [
  { at: S + 0.3, id: "claude", session: "trips", scroll: 0, glow: mark.kyoto },
  { at: S + 0.75, id: "notes", glow: mark.kyoto },
  { at: S + 1.2, id: "browser", tab: "gion", glow: mark.kyoto },
];

/** By hand: the session, three tabs, then the terminal picked out in Mission Control. */
const slowChanges: Change[] = [
  { at: B + 3.65, id: "claude", session: "tokenizer" },
  { at: B + 4.75, id: "browser", tab: "mail" },
  { at: B + 5.2, id: "browser", tab: "docs" },
  { at: B + 5.65, id: "browser", tab: "pr" },
  { at: B + 7.55, id: "terminal" },
];

/** With Screencap: each place comes forward, the one the thread is most about last, so it ends up in front. */
const fastChanges: Change[] = [
  { at: C + 5.7, id: "terminal", glow: mark.tokenizer },
  { at: C + 5.85, id: "browser", tab: "pr", glow: mark.tokenizer },
  { at: C + 6.0, id: "claude", session: "tokenizer", scroll: 140, glow: mark.tokenizer },
];
const anyChanges: Change[] = [
  { at: D + 2.1, id: "claude", session: "trips", scroll: 0, glow: mark.kyoto },
  { at: D + 2.25, id: "notes", glow: mark.kyoto },
  { at: D + 2.4, id: "browser", tab: "gion", glow: mark.kyoto },
];

/** Applies the changes made by `t`. A ring fades in as its change happens and out a second later, or at `hold`. */
function apply(state: DesktopState, changes: Change[], t: number, raise = true): DesktopState {
  const out: DesktopState = { ...state, order: [...state.order], glow: { ...(state.glow ?? {}) } };
  for (const c of changes) {
    if (c.at > t) continue;
    if (raise) out.order = [...out.order.filter((id) => id !== c.id), c.id];
    if (c.tab) out.tab = tabIndex(c.tab);
    if (c.session) out.session = c.session;
    if (c.scroll !== undefined) out.sidebarScroll = c.scroll;
    if (c.glow) {
      const off = c.hold ?? c.at + 1.1;
      out.glow![c.id] = { color: c.glow, strength: ramp(t, c.at, c.at + 0.2) * (1 - ramp(t, off, off + 0.4)) };
    }
  }
  return out;
}

/** Where the dip between the slow way and the fast one switches the screen back to the trip. */
const reset = C + 0.17;

/** The menu-bar clock: the bug fix at 13:20, the trip at 13:52, and later, when you want the bug fix back, 15:30. */
const clockAt = (t: number) => (t < S + 0.3 ? "13:20" : t < B ? "13:52" : "15:30");

export function desktopAt(t: number): DesktopState {
  let s: DesktopState;
  if (t < S) s = apply(tokenizerScreen, workRings, t, false);
  else if (t < B) s = apply(tokenizerScreen, switchChanges, t);
  else if (t < reset) {
    s = apply(kyotoScreen, slowChanges, t);
    s.sidebarScroll = s.session === "tokenizer" ? 140 : ease(t, [[B + 2.8, 0], [B + 3.25, 140]]);
    s.mission = Math.min(ramp(t, B + 6.55, B + 6.95), 1 - ramp(t, B + 7.6, B + 8));
    s.missionHover = t > B + 7.25 && t < B + 7.6 ? "terminal" : undefined;
  } else if (t < D) s = apply(kyotoScreen, fastChanges, t);
  else s = apply(apply(kyotoScreen, fastChanges, D), anyChanges, t);
  return { ...s, clock: clockAt(t) };
}

/* ---------- the camera ---------- */

/** Where the camera looks, as [seconds, centre x, centre y, zoom] in screen points; it eases between them. */
const full = [screen.width / 2, screen.height / 2, 1] as const;
const palette = [512, 316, 1.16] as const;
const shots: [number, number, number, number][] = [
  [0, ...full],
  [B + 2.4, ...full],
  [B + 2.7, 150, 330, 1.75], // Claude's sidebar
  [B + 3.95, 150, 330, 1.75],
  [B + 4.25, 760, 200, 1.75], // the browser
  [B + 5.95, 760, 200, 1.75],
  [B + 6.25, ...full],
  [C + 0.7, ...full],
  [C + 1.0, ...palette],
  [C + 5.45, ...palette],
  [C + 5.75, ...full],
  [D + 0.5, ...full],
  [D + 0.8, ...palette],
  [D + 1.85, ...palette],
  [D + 2.15, ...full],
];
export const cameraAt = (t: number) => ({
  x: ease(t, shots.map(([at, x]) => [at, x])),
  y: ease(t, shots.map(([at, , y]) => [at, y])),
  zoom: ease(t, shots.map(([at, , , z]) => [at, z])),
});

/* ---------- the pointer, which only the slow way needs ---------- */

// The tokenizer's row in Claude's sidebar once it has been scrolled into view, in screen points.
const sessionClick = { x: frames.claude.x + 100, y: frames.claude.y + sessionRow(12, 140).y + 18 };
const tabCenter = (index: number, chosen: number) => {
  const r = tabRect(index, chosen);
  return { x: frames.browser.x + r.x + r.width / 2, y: frames.browser.y + r.y + r.height / 2 };
};
const inbox = tabCenter(1, 0), roadmap = tabCenter(2, 1), pr = tabCenter(3, 2);
const missionTerminal = { x: 560, y: 452 };

export const clicks = [B + 3.65, B + 4.75, B + 5.2, B + 5.65, B + 7.55];
// The pointer rests a moment on everything it clicks, so the click's ring spreads from under it.
const path: [number, number, number][] = [
  [B, 600, 330], [B + 2.5, 300, 360], [B + 2.75, 112, 360], [B + 3.3, 112, 380],
  [B + 3.55, sessionClick.x, sessionClick.y], [B + 3.8, sessionClick.x, sessionClick.y],
  [B + 4.6, inbox.x, inbox.y], [B + 4.83, inbox.x, inbox.y], [B + 5.1, roadmap.x, roadmap.y], [B + 5.28, roadmap.x, roadmap.y],
  [B + 5.55, pr.x, pr.y], [B + 5.75, pr.x, pr.y], [B + 6.3, 700, 300],
  [B + 7.2, missionTerminal.x, missionTerminal.y], [B + 7.7, missionTerminal.x, missionTerminal.y], [B + 8.6, 700, 540],
];
export function cursorAt(t: number) {
  const x = ease(t, path.map(([at, px]) => [at, px]));
  const y = ease(t, path.map(([at, , py]) => [at, py]));
  const pressed = Math.max(0, ...clicks.map((c) => 1 - Math.min(1, Math.abs(t - c) / 0.08)));
  return { x, y, pressed, opacity: ramp(t, B + 0.2, B + 0.5) * (1 - ramp(t, C - 0.3, C)) };
}

/* ---------- the captions ---------- */

// One short line under the screen for each beat, saying what is happening; the screen shows the rest. `{⌥}{Space}`
// is a keycap, lit while that key is pressed.
export const captions: { from: number; to: number; text: string }[] = [
  { from: 0.15, to: S - 0.05, text: "You're fixing a bug across three apps" },
  { from: S, to: B - 0.1, text: "Then you switch to planning a trip" },
  { from: B + 0.05, to: B + 2.3, text: "Later, you want the bug fix back" },
  { from: B + 2.35, to: B + 3.85, text: "Without Screencap: find the session" },
  { from: B + 3.9, to: B + 5.9, text: "Then the pull request" },
  { from: B + 5.95, to: B + 7.95, text: "Then the terminal, under Notes {⌃}{↑}" },
  { from: B + 8, to: C - 0.1, text: "Seven steps, every time you switch" },
  { from: C + 0.05, to: C + 1.6, text: "Same moment, with Screencap: {⌥}{Space}" },
  { from: C + 1.65, to: C + 3.1, text: "Smart capture remembered every thread" },
  { from: C + 3.15, to: C + 5.0, text: "{⇥} shows what the bug fix had open" },
  { from: C + 5.05, to: D - 0.1, text: "{↩} brings it all back" },
  { from: D + 0.05, to: acts.end - 0.1, text: "The trip, the same way: {⌥}{Space} {↩}" },
  { from: acts.end, to: duration, text: "Resume, in Screencap" },
];

/** When each key is pressed, so its keycap in the caption lights up. */
export const presses: { at: number; key: string }[] = [
  { at: B + 6.5, key: "⌃" }, { at: B + 6.5, key: "↑" },
  { at: C + 0.6, key: "⌥" }, { at: C + 0.6, key: "Space" },
  { at: C + 3.5, key: "⇥" },
  { at: C + 5.4, key: "↩" },
  { at: D + 0.4, key: "⌥" }, { at: D + 0.4, key: "Space" },
  { at: D + 1.8, key: "↩" },
];
export const pressedAt = (t: number) => (key: string) =>
  Math.max(0, ...presses.filter((p) => p.key === key).map((p) => (t < p.at ? 0 : 1 - ramp(t, p.at + 0.25, p.at + 0.5))));

/* ---------- the palette ---------- */

export const paletteAt = (t: number) => {
  if (t < D) return { state: t >= C + 3.5 ? "a-0-places" : "a-0", open: Math.min(ramp(t, C + 0.7, C + 0.85), 1 - ramp(t, C + 5.45, C + 5.6)) };
  return { state: "b-0", open: Math.min(ramp(t, D + 0.5, D + 0.65), 1 - ramp(t, D + 1.85, D + 2.0)) };
};

/** The dip to black that takes the slow way back to the moment it started from. */
export const dipAt = (t: number) => Math.min(ramp(t, C, C + 0.15), 1 - ramp(t, C + 0.2, C + 0.35));
