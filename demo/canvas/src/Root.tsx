import React from "react";
import { Composition, useCurrentFrame } from "remotion";
import { screen, screens } from "./day";
import { Desktop } from "./desktop";
import { hosts, Icon } from "./icons";

const Screens = () => {
  const { place, index } = screens[useCurrentFrame()];
  return <Desktop place={place} index={index} clock="Thu 12 Nov" />;
};
const Icons = () => <Icon host={hosts[useCurrentFrame()]} />;

/** The film is made after the screens are, so the demo is only there once it is. */
const film = (() => {
  try {
    return { ...require("./Demo"), ...require("./script") } as typeof import("./Demo") & typeof import("./script");
  } catch {
    return undefined;
  }
})();

export function Root() {
  return (
    <>
      <Composition id="Icons" component={Icons} durationInFrames={hosts.length} fps={30} width={128} height={128} />
      <Composition id="Screens" component={Screens} durationInFrames={screens.length} fps={30} width={screen.width} height={screen.height} />
      {film && <Composition id="Demo" component={film.Demo} durationInFrames={Math.floor(film.duration * film.fps)} fps={film.fps} width={film.frameSize.width} height={film.frameSize.height} />}
    </>
  );
}
