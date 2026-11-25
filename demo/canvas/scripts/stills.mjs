// Draws the made-up sites' icons, then every screen of the made-up days, each as a PNG the app builds its store from.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";

const out = "public/generated";
const day = JSON.parse(readFileSync("day.json", "utf8"));
const hosts = [...readFileSync("src/icons.tsx", "utf8").matchAll(/^  "([a-z.]+)": \[/gm)].map((m) => m[1]);
const screens = Object.entries(day.places).flatMap(([id, place]) =>
  Array.from({ length: place.screens }, (_, i) => `${id}-${String(i).padStart(2, "0")}`),
);

function sequence(composition, names, folder, ...flags) {
  const work = `${out}/${folder}-frames`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(`${out}/${folder}`, { recursive: true });
  execFileSync("npx", ["remotion", "render", "src/index.ts", composition, work, "--sequence", "--image-format=png", "--log=error", ...flags], { stdio: "inherit" });
  const frames = readdirSync(work).filter((f) => f.endsWith(".png")).sort();
  if (frames.length !== names.length) throw new Error(`${composition}: ${frames.length} frames for ${names.length} names`);
  frames.forEach((f, i) => renameSync(`${work}/${f}`, `${out}/${folder}/${names[i]}.png`));
  rmSync(work, { recursive: true });
  console.log(`${folder}: ${names.length}`);
}

sequence("Icons", hosts, "icons");
sequence("Screens", screens, "screens", "--scale=1.6");
// The same screens, small, for the heap the day makes before Screencap sorts it.
sequence("Screens", screens, "small", "--scale=0.8");
