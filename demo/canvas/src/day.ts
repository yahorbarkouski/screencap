import raw from "../day.json";

export type PlaceID = keyof typeof raw.places;
type Place = { app: keyof typeof raw.apps; title: string; screens: number; host?: string; path?: string; session?: string };

export const screen = raw.screen;
export const places = raw.places as Record<PlaceID, Place>;
export const apps = raw.apps;
/** The day the demo is about: its visits in order, with the minute of the day each starts at. */
export const visits = (() => {
  const out: { thread: string; place: PlaceID; minutes: number; start: number }[] = [];
  for (const [at, list] of raw.days[0].runs as [string, [string, PlaceID, number, string][]][]) {
    const [h, m] = at.split(":").map(Number);
    let start = h * 60 + m;
    for (const [thread, place, minutes] of list) {
      out.push({ thread, place, minutes, start });
      start += minutes;
    }
  }
  return out;
})();

/** Every screen there is, in the order the `Screens` composition draws them, one a frame. */
export const screens = (Object.keys(places) as PlaceID[]).flatMap((place) =>
  Array.from({ length: places[place].screens }, (_, index) => ({ place, index, of: places[place].screens })),
);
/** The file of a place's screen, as the stills script names it. */
export const file = (place: PlaceID, index: number) => `${place}-${String(index).padStart(2, "0")}`;
