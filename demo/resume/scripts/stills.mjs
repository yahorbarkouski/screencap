// Renders each thread's screen, as it was left, at twice its size: the frames the palette's preview shows.
import { execFileSync } from "node:child_process";

for (const id of ["tokenizer", "kyoto"]) {
  execFileSync(
    "npx",
    ["remotion", "still", "src/index.ts", `screen-${id}`, `public/generated/stills/${id}.png`, "--scale=2", "--log=error"],
    { stdio: "inherit" },
  );
}
