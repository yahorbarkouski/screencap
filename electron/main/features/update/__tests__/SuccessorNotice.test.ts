import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "../../../testUtils/tmp";

let userDataDir = "";
let cleanup: (() => Promise<void>) | null = null;

let focusedWindow: object | null = {};
const focusListeners: Array<() => void> = [];
const showMessageBox = vi.fn();
const openExternal = vi.fn();
const setTraySuccessorUrl = vi.fn();

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => {
			if (name === "userData") return userDataDir;
			throw new Error("Unsupported app.getPath");
		},
		runningUnderARM64Translation: false,
		once: (event: string, listener: () => void) => {
			if (event === "browser-window-focus") focusListeners.push(listener);
		},
	},
	BrowserWindow: { getFocusedWindow: () => focusedWindow },
	dialog: { showMessageBox },
	net: { fetch: vi.fn() },
	shell: { openExternal },
}));

vi.mock("../../../app/tray", () => ({ setTraySuccessorUrl }));

const realArch = process.arch;

function runOn(arch: string, systemVersion: string): void {
	Object.defineProperty(process, "arch", { value: arch, configurable: true });
	Object.defineProperty(process, "getSystemVersion", {
		value: () => systemVersion,
		configurable: true,
	});
}

const release = {
	tag_name: "v2.0.0",
	html_url: "https://github.com/yahorbarkouski/screencap/releases/tag/v2.0.0",
};

describe("SuccessorNotice", () => {
	beforeEach(async () => {
		const tmp = await createTempDir("screencap-successor-test-");
		userDataDir = tmp.dir;
		cleanup = tmp.cleanup;
		focusedWindow = {};
		focusListeners.length = 0;
		vi.clearAllMocks();
		vi.resetModules();
	});

	afterEach(async () => {
		Object.defineProperty(process, "arch", {
			value: realArch,
			configurable: true,
		});
		await cleanup?.();
		cleanup = null;
	});

	it("finds Screencap 2 only in a 2.x release of this repository", async () => {
		const { parseSuccessor } = await import("../SuccessorNotice");
		expect(parseSuccessor(release)).toEqual({
			version: "2.0.0",
			url: release.html_url,
		});
		expect(parseSuccessor({ ...release, tag_name: "2.1.0" })?.version).toBe(
			"2.1.0",
		);
		expect(parseSuccessor({ ...release, tag_name: "v1.36.0" })).toBeNull();
		expect(parseSuccessor({ ...release, tag_name: "latest" })).toBeNull();
		expect(
			parseSuccessor({ ...release, html_url: "https://example.com/v2.0.0" }),
		).toBeNull();
		expect(parseSuccessor({ message: "Not Found" })).toBeNull();
		expect(parseSuccessor(null)).toBeNull();
	});

	it("knows which Macs can run Screencap 2", async () => {
		const { canRunSuccessor } = await import("../SuccessorNotice");
		expect(canRunSuccessor("arm64", false, "26.0.1")).toBe(true);
		expect(canRunSuccessor("x64", true, "26.1.0")).toBe(true);
		expect(canRunSuccessor("arm64", false, "15.7.1")).toBe(false);
		expect(canRunSuccessor("x64", false, "26.0.0")).toBe(false);
	});

	it("reminds at most once a day until dismissed", async () => {
		const { shouldShowNotice } = await import("../SuccessorNotice");
		const now = Date.parse("2026-10-20T12:00:00Z");
		const hour = 60 * 60 * 1000;
		expect(shouldShowNotice({ dismissed: false, shownAt: 0 }, now)).toBe(true);
		expect(
			shouldShowNotice({ dismissed: false, shownAt: now - 23 * hour }, now),
		).toBe(false);
		expect(
			shouldShowNotice({ dismissed: false, shownAt: now - 25 * hour }, now),
		).toBe(true);
		expect(shouldShowNotice({ dismissed: true, shownAt: 0 }, now)).toBe(false);
	});

	it("reads a missing or broken state file as never shown", async () => {
		const { readNoticeState, writeNoticeState } = await import(
			"../SuccessorNotice"
		);
		expect(readNoticeState()).toEqual({ dismissed: false, shownAt: 0 });
		writeFileSync(join(userDataDir, "successor-notice.json"), "{not json");
		expect(readNoticeState()).toEqual({ dismissed: false, shownAt: 0 });
		writeNoticeState({ dismissed: true, shownAt: 42 });
		expect(readNoticeState()).toEqual({ dismissed: true, shownAt: 42 });
	});

	it("opens the release page and remembers Don't show this again", async () => {
		runOn("arm64", "26.0.0");
		showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true });
		const { offerSuccessor, readNoticeState } = await import(
			"../SuccessorNotice"
		);
		const successor = { version: "2.0.0", url: release.html_url };

		await offerSuccessor(successor);
		expect(setTraySuccessorUrl).toHaveBeenCalledWith(release.html_url);
		expect(showMessageBox).toHaveBeenCalledTimes(1);
		expect(openExternal).toHaveBeenCalledWith(release.html_url);
		expect(readNoticeState().dismissed).toBe(true);

		await offerSuccessor(successor);
		expect(showMessageBox).toHaveBeenCalledTimes(1);
	});

	it("waits until a Screencap window is in front", async () => {
		runOn("arm64", "26.0.0");
		focusedWindow = null;
		showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
		const { offerSuccessor, readNoticeState } = await import(
			"../SuccessorNotice"
		);
		const successor = { version: "2.0.0", url: release.html_url };

		await offerSuccessor(successor);
		await offerSuccessor(successor);
		expect(showMessageBox).not.toHaveBeenCalled();
		expect(setTraySuccessorUrl).toHaveBeenCalledWith(release.html_url);
		expect(focusListeners).toHaveLength(1);

		focusedWindow = {};
		focusListeners[0]();
		await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
		await vi.waitFor(() =>
			expect(readNoticeState().shownAt).toBeGreaterThan(0),
		);
		expect(readNoticeState().dismissed).toBe(false);
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("tells an unsupported Mac once, with no download link", async () => {
		runOn("x64", "15.7.1");
		showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
		const { offerSuccessor, readNoticeState } = await import(
			"../SuccessorNotice"
		);

		await offerSuccessor({ version: "2.0.0", url: release.html_url });
		expect(setTraySuccessorUrl).not.toHaveBeenCalled();
		expect(openExternal).not.toHaveBeenCalled();
		expect(showMessageBox.mock.calls[0][0].message).toBe(
			"Screencap 2 needs macOS 26 on Apple Silicon",
		);
		expect(readNoticeState().dismissed).toBe(true);
	});
});
