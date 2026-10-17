import React from "react";
import { Composition, Still } from "remotion";
import { Demo, duration, frameSize } from "./Demo";
import { Desktop } from "./desktop";
import { screen } from "./layout";
import { kyotoScreen, tokenizerScreen } from "./script";
import { fps } from "./timeline";

/** The demo, and each thread's screen as it was left, which `Screencap resume-story` shows in the palette's preview. */
const stills = { tokenizer: tokenizerScreen, kyoto: kyotoScreen };

export function Root() {
  return (
    <>
      <Composition id="Demo" component={Demo} durationInFrames={Math.round(duration * fps)} fps={fps} width={frameSize.width} height={frameSize.height} />
      {(Object.keys(stills) as (keyof typeof stills)[]).map((id) => (
        <Still key={id} id={`screen-${id}`} component={() => <Desktop state={stills[id]} />} width={screen.width} height={screen.height} />
      ))}
    </>
  );
}
