import { ease, ramp } from "../../resume/src/timeline";
import manifest from "../public/generated/app/manifest.json";
import { file, places, screens, visits } from "./day";
import { mix, part, rand } from "./screens/kit";

// The demo's plot. It opens on what is going on and why it hurts, and only then shows Screencap; from `app` on, what is
// shown is the app itself, filmed by `Screencap canvas-story`, whose marks say when each part starts.
//
//   deal   0.0   a day on a Mac: one window after another, faster and faster, into a heap
//   blur   2.9   by evening nothing in it can be told apart
//   fly    5.0   every screen flies to its place, and the app is there when they land
//   app    6.3   the film

export const fps = 60;
export const acts = { deal: 0, blur: 2.9, fly: 5.0, app: 6.3 };
export const filmed = manifest.frames / manifest.fps;
export const duration = acts.app + filmed;

type Mark = keyof typeof manifest.marks;
const at = (mark: Mark, after = 0) => acts.app + manifest.marks[mark] + after;

/* ---------- the heap ---------- */

export type Frame = { x: number; y: number; width: number; height: number };
export type Plate = { screen: string; place: string; frame: Frame; part: Frame; radius: number };
const rect = ([x, y, width, height]: number[]): Frame => ({ x, y, width, height });
export const plates: Plate[] = manifest.plates.map((p) => ({ ...p, frame: rect(p.frame), part: rect(p.part) }));
export const film = { width: manifest.width, height: manifest.height, bar: manifest.bar, frames: manifest.frames, fps: manifest.fps };

/** One screen of the day, dealt onto the heap at `lands`; `x` and `y` are its centre, from the heap's middle. */
export type Card = { screen: string; clock: string; lands: number; x: number; y: number; turn: number; plate?: Plate; leads: boolean };

export const cards: Card[] = (() => {
  const total: Record<string, number> = {}, seen: Record<string, number> = {};
  for (const v of visits) total[v.place] = (total[v.place] ?? 0) + v.minutes;
  const dealt = visits.flatMap((v) => {
    const p = ((seen[v.place] ?? 0) + v.minutes / 2) / total[v.place];
    seen[v.place] = (seen[v.place] ?? 0) + v.minutes;
    const index = Math.min(places[v.place].screens - 1, Math.round(p * (places[v.place].screens - 1)));
    const card = { place: v.place, screen: file(v.place, index), start: v.start };
    // A long visit is dealt twice.
    return v.minutes >= 14 ? [card, { ...card, screen: file(v.place, Math.min(places[v.place].screens - 1, index + 1)), start: v.start + 8 }] : [card];
  });
  // The last card of a thing is the one its picture on the canvas is drawn from.
  const last: Record<string, number> = {};
  dealt.forEach((d, i) => (last[d.place] = i));
  return dealt.map((d, i) => {
    const k = i / (dealt.length - 1);
    const plate = plates.find((p) => p.place === d.place);
    const leads = last[d.place] === i && !!plate;
    const out = 1500 * Math.sqrt(k);
    const angle = i * 2.39996;
    return {
      screen: leads ? plate!.screen : d.screen,
      clock: `${String(Math.floor(d.start / 60)).padStart(2, "0")}:${String(d.start % 60).padStart(2, "0")}`,
      // Half a second apart at first, then faster and faster.
      lands: i === 0 ? -1 : mix(0.45, 3.5, Math.pow(k, 0.46)),
      x: i === 0 ? 0 : Math.cos(angle) * out * 0.86,
      y: i === 0 ? 0 : Math.sin(angle) * out * 0.5,
      turn: i === 0 ? 0 : (rand(i + 3) - 0.5) * 22,
      plate,
      leads,
    };
  });
})();

/** The clock in the menu bar, from the card dealt last. */
export const clockAt = (t: number) => [...cards].reverse().find((c) => c.lands <= t)?.clock ?? cards[0].clock;
/** How far back the heap is looked at from, as its scale: the first window fills the screen. */
export const heapScale = (t: number) => ease(t, [[0.35, 1.12], [3.7, 0.345], [acts.fly, 0.33]]);
/** How far a card has landed: it drops in from a little above. */
export const landed = (t: number, card: Card) => ramp(t, card.lands - 0.02, card.lands + 0.2);
export const blurAt = (t: number) => 9 * ramp(t, acts.blur + 0.35, acts.blur + 1.5) * (1 - ramp(t, acts.fly - 0.05, acts.fly + 0.35));
/** How far a card has flown to its place; they leave one after another, the canvas's left first. */
export function flown(t: number, card: Card) {
  if (!card.plate) return part(t, acts.fly, acts.fly + 0.4);
  const late = 0.34 * (card.plate.frame.x / film.width) + 0.12 * rand(card.x + card.y) - (card.leads ? 0.04 : 0);
  return ramp(t, acts.fly + late, acts.fly + late + 0.72);
}
/** The app's window comes up around them, and takes their place once they have landed. */
export const roomAt = (t: number) => ramp(t, acts.fly, acts.fly + 0.45);
export const filmAt = (t: number) => ramp(t, acts.app - 0.26, acts.app - 0.04);

/** The film's frame at `t`. */
export const filmFrame = (t: number) => Math.min(film.frames - 1, Math.max(0, Math.round((t - acts.app) * film.fps)));

/* ---------- the captions ---------- */

// One short line under the screen for each beat, saying what is happening; the screen shows the rest.
export const captions: { from: number; to: number; text: string }[] = [
  { from: 0.15, to: acts.blur - 0.15, text: "A day on your Mac" },
  { from: acts.blur - 0.05, to: acts.fly - 0.1, text: "By evening, it's a blur" },
  { from: acts.fly, to: at("canvas", 0.75), text: "Screencap lays it out" },
  { from: at("canvas", 0.85), to: at("skim", -0.15), text: "One picture for each thing you did" },
  { from: at("skim", -0.05), to: at("skim", 1.9), text: "Nine visits to a stream, one picture" },
  { from: at("skim", 2.0), to: at("open", -0.05), text: "Run along it to see them all" },
  { from: at("open", 0.05), to: at("close", -0.1), text: "Open any moment" },
  { from: at("close"), to: at("find", -0.1), text: "Click a thread to come closer" },
  { from: at("find"), to: at("timeline", -0.1), text: "Find anything in the day" },
  { from: at("timeline"), to: at("days", -0.1), text: "See when it happened, on Timeline" },
  { from: at("days"), to: at("end", -0.1), text: "And go back through every day" },
  { from: at("end"), to: duration, text: "Canvas, in Screencap" },
];
