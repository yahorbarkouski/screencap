import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, dialog, net, shell } from "electron";
import { setTraySuccessorUrl } from "../../app/tray";
import { createLogger } from "../../infra/log";
import { getSuccessorNoticePath } from "../../infra/paths";

// Screencap 2 is a native rewrite published from the same repository. Once a
// 2.x release is the latest one, its release has no latest-mac.yml, so this app
// stops looking for updates and points people to Screencap 2 instead.

const logger = createLogger({ scope: "SuccessorNotice" });

const LATEST_RELEASE_URL =
	"https://api.github.com/repos/yahorbarkouski/screencap/releases/latest";
const RELEASES_PAGE_PREFIX =
	"https://github.com/yahorbarkouski/screencap/releases/";
const FETCH_TIMEOUT_MS = 10_000;
const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;

export type Successor = { version: string; url: string };
export type NoticeState = { dismissed: boolean; shownAt: number };

export function parseSuccessor(release: unknown): Successor | null {
	if (!release || typeof release !== "object") return null;
	const { tag_name: tag, html_url: url } = release as Record<string, unknown>;
	if (typeof tag !== "string" || typeof url !== "string") return null;
	const major = Number(/^v?(\d+)\./.exec(tag)?.[1]);
	if (!(major >= 2) || !url.startsWith(RELEASES_PAGE_PREFIX)) return null;
	return { version: tag.replace(/^v/, ""), url };
}

// Screencap 2 needs macOS 26 on Apple Silicon. An Intel build of this app
// running under Rosetta is on Apple Silicon too.
export function canRunSuccessor(
	arch: string,
	underRosetta: boolean,
	systemVersion: string,
): boolean {
	const major = Number(systemVersion.split(".")[0]);
	return (arch === "arm64" || underRosetta) && major >= 26;
}

export function shouldShowNotice(state: NoticeState, now: number): boolean {
	return !state.dismissed && now - state.shownAt >= REMIND_AFTER_MS;
}

export function readNoticeState(): NoticeState {
	const path = getSuccessorNoticePath();
	try {
		if (!existsSync(path)) return { dismissed: false, shownAt: 0 };
		const raw = JSON.parse(readFileSync(path, "utf8"));
		return {
			dismissed: raw?.dismissed === true,
			shownAt: Number.isFinite(raw?.shownAt) ? raw.shownAt : 0,
		};
	} catch {
		return { dismissed: false, shownAt: 0 };
	}
}

export function writeNoticeState(state: NoticeState): void {
	try {
		writeFileSync(getSuccessorNoticePath(), JSON.stringify(state));
	} catch (error) {
		logger.warn("Failed to save notice state", { error: String(error) });
	}
}

export async function findSuccessor(): Promise<Successor | null> {
	try {
		const response = await net.fetch(LATEST_RELEASE_URL, {
			headers: { Accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		return parseSuccessor(await response.json());
	} catch (error) {
		logger.warn("Failed to read the latest release", { error: String(error) });
		return null;
	}
}

let showing = false;
let waitingForFocus = false;

export async function offerSuccessor(successor: Successor): Promise<void> {
	const supported = canRunSuccessor(
		process.arch,
		app.runningUnderARM64Translation,
		process.getSystemVersion(),
	);
	if (supported) setTraySuccessorUrl(successor.url);

	if (showing || waitingForFocus) return;
	if (!shouldShowNotice(readNoticeState(), Date.now())) return;
	// The notice waits until a Screencap window is in front, so it never lands
	// on top of work in another app.
	if (!BrowserWindow.getFocusedWindow()) {
		waitingForFocus = true;
		app.once("browser-window-focus", () => {
			waitingForFocus = false;
			void offerSuccessor(successor);
		});
		return;
	}
	showing = true;
	logger.info("Showing the Screencap 2 notice", {
		version: successor.version,
		supported,
	});
	try {
		if (supported) {
			const { response, checkboxChecked } = await dialog.showMessageBox({
				type: "info",
				message: "Screencap 2 is here",
				detail:
					"Screencap 2 is Screencap rebuilt as a native Mac app. It replaces this app, which gets no more updates.\n\nTo switch, quit this app, then install Screencap 2 from its download page. Screencap 2 starts a new history; what this app recorded stays on your Mac.",
				buttons: ["Get Screencap 2", "Later"],
				defaultId: 0,
				cancelId: 1,
				checkboxLabel: "Don't show this again",
			});
			writeNoticeState({ dismissed: checkboxChecked, shownAt: Date.now() });
			if (response === 0) void shell.openExternal(successor.url);
		} else {
			await dialog.showMessageBox({
				type: "info",
				message: "Screencap 2 needs macOS 26 on Apple Silicon",
				detail:
					"Screencap 2, the native app that replaces this one, can't run on this Mac. This app keeps working here and gets no more updates.",
				buttons: ["OK"],
			});
			writeNoticeState({ dismissed: true, shownAt: Date.now() });
		}
	} finally {
		showing = false;
	}
}
