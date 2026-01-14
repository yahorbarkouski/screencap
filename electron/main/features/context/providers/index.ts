export {
	APPLE_MUSIC_BUNDLE_IDS,
	appleMusicProvider,
	getAppleMusicAutomationError,
	getAppleMusicAutomationState,
} from "./AppleMusicProvider";
export {
	chromiumProvider,
	getChromiumAutomationError,
	getChromiumAutomationState,
	getSupportedBrowserBundleIds,
} from "./ChromiumProvider";
export { cursorProvider } from "./CursorProvider";
export { getContextProviders, registerProvider } from "./registry";
export {
	getSafariAutomationError,
	getSafariAutomationState,
	safariProvider,
} from "./SafariProvider";
export {
	getSpotifyAutomationError,
	getSpotifyAutomationState,
	SPOTIFY_BUNDLE_IDS,
	spotifyProvider,
} from "./SpotifyProvider";
export {
	collectForegroundSnapshot,
	getAutomationState,
	getLastAutomationError,
} from "./SystemEventsProvider";
export type { BackgroundCapableProvider, ContextProvider } from "./types";
export { isBackgroundCapable } from "./types";
