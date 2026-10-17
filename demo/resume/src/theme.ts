/** System fonts, which the headless browser takes from this Mac: SF Pro and SF Mono, as the apps use. */
export const ui = '-apple-system, "SF Pro Text", "Helvetica Neue", sans-serif';
export const display = '-apple-system, "SF Pro Display", "Helvetica Neue", sans-serif';
export const mono = '"SF Mono", Menlo, monospace';

/** Screencap's own inks in dark mode (`Theme.swift`): one near-white ink at several strengths. */
export const ink = {
  text: "#EDEDEA",
  secondary: "#A8A7A1",
  tertiary: "#7D7C77",
  quiet: "#64635F",
  hairline: "rgba(255,255,255,0.12)",
  wash: "rgba(255,255,255,0.07)",
};

/** Screencap's surfaces: the window's and the menu-bar panel's near-black, with a hairline edge. */
export const surface = {
  panel: "rgba(28,28,30,0.96)",
  edge: "inset 0 0 0 1px rgba(255,255,255,0.12)",
  shadow: "0 18px 50px rgba(0,0,0,0.5)",
};

/** The only hues: thread marks (`Theme.marks`), and green and red for meaning (`Theme.exact`, `Theme.destructive`). */
export const mark = { tokenizer: "#2563EB", kyoto: "#15803D" };
export const exact = "#3B9555";
export const destructive = "#D6332F";

/** The README's backdrop (`scripts/readme-shots.py`): near-black, lit from its edges by indigo, violet, teal and pink,
 * a little quieter along the bottom, where the captions are. */
export const backdrop = [
  "radial-gradient(42% 30% at 10% -5%, rgba(99,102,241,0.55), transparent 100%)",
  "radial-gradient(30% 26% at 95% 10%, rgba(139,92,246,0.55), transparent 100%)",
  "radial-gradient(40% 22% at 82% 108%, rgba(20,184,166,0.42), transparent 100%)",
  "radial-gradient(24% 20% at -5% 102%, rgba(219,39,119,0.42), transparent 100%)",
  "#08090e",
].join(", ");
