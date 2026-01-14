import { appleMusicProvider } from "./AppleMusicProvider";
import { chromiumProvider } from "./ChromiumProvider";
import { cursorProvider } from "./CursorProvider";
import { safariProvider } from "./SafariProvider";
import { spotifyProvider } from "./SpotifyProvider";
import type { ContextProvider } from "./types";

const builtInProviders: ContextProvider[] = [
	safariProvider,
	chromiumProvider,
	spotifyProvider,
	appleMusicProvider,
	cursorProvider,
];

export function getContextProviders(): ContextProvider[] {
	return [...builtInProviders].sort(
		(a, b) => (b.priority ?? 0) - (a.priority ?? 0),
	);
}

export function registerProvider(provider: ContextProvider): void {
	builtInProviders.push(provider);
}
