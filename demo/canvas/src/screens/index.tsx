import React from "react";
import { PlaceID, places } from "../day";
import { Launch } from "./launch";
import { Bread, Board, Calendar, Chess, Easel, Flat, Invoices, Music, Run, Weather } from "./rest";
import { Map, Notes, Shrine, Stay } from "./trip";
import { Claude, Grammar, PullRequest, Relay, Roadmap, Terminal } from "./work";

/** A place's window, `index` of its screens in. */
export function Window({ place, index }: { place: PlaceID; index: number }) {
  const p = places[place].screens > 1 ? index / (places[place].screens - 1) : 0;
  switch (place) {
    case "launch": return <Launch p={p} />;
    case "claude-lexer": return <Claude kind="lexer" p={p} />;
    case "claude-kyoto": return <Claude kind="kyoto" p={p} />;
    case "pr": return <PullRequest p={p} />;
    case "terminal": return <Terminal p={p} />;
    case "grammar": return <Grammar p={p} />;
    case "map": return <Map p={p} />;
    case "shrine": return <Shrine p={p} />;
    case "stay": return <Stay p={p} />;
    case "notes": return <Notes p={p} />;
    case "easel": return <Easel p={p} />;
    case "board": return <Board p={p} />;
    case "roadmap": return <Roadmap p={p} />;
    case "relay": return <Relay p={p} />;
    case "chess": return <Chess p={p} />;
    case "flat": return <Flat p={p} />;
    case "run": return <Run p={p} />;
    case "bread": return <Bread p={p} />;
    case "invoices": return <Invoices p={p} />;
    case "weather": return <Weather p={p} />;
    case "calendar": return <Calendar p={p} />;
    case "music": return <Music p={p} />;
  }
}
