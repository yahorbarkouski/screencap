import { app, Menu, nativeImage, screen, Tray } from "electron";
import {
	startScheduler,
	stopScheduler,
	triggerManualCaptureWithPrimaryDisplay,
} from "../features/scheduler";
import { createLogger } from "../infra/log";
import { togglePopupWindow } from "./popup";
import { destroyMainWindow, showMainWindow } from "./window";

let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let quitCallback: (() => void) | null = null;
let unreadCount = 0;
let updateReady = false;

const logger = createLogger({ scope: "Tray" });

const TRAY_ICON_PNG_16_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAA9klEQVQ4jcWSP05CQRjEf58BRBsoCI2FtNzAhNbOwqvQQUJHhw3xDl7ChsTGUHkGCSfA4skDdCjep3lZdk0IhdPs5vszM5ldOBEWK0pqAXVgDVwA8ntmZtmfjJIuVeBLh3gI58+C5XtgAmSu+AHkpXtP0lRSPaX+6ErDRD/zfuOnVglmroIzxAioAp8pgndgB3QlPQELoAN8A0vgxcyeE+S/No8K8eAZJVXd6nXEwQA4B5pmtoqp30oaSbpJuNu4k3YqgzugD2yBeYRjRxFiniKYUfy6saSxW6+Ult+A1zJBzOZpITpJA6gBG4rQcNXczNZJ9X/BHvnYyDcic9GSAAAAAElFTkSuQmCC";

const TRAY_ICON_PNG_32_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAABjUlEQVRYhe2WPUsDQRCGn1GjJmokooWYGCv/kX/AQiysLCxtLC1stDWN/g3b2Fhb2PgNgh8E/AhcYCxuwi3h7rIXI4GQFw7e2Z2dndudfXdhhAFDfJxUdRxYd8YUgYbZJeAjhr+LyEtfslTVRfVD4PBjn9hjfcnwD5hI6rBlL5u50EPsWVWtGv8Ukbc4p8QasMG3TtMZcEG4asvAk7WvAvfGK8CD8SNg3nhNRDbj5klcgRhcikjN11lVD3380mqgsy/nO3kWpK1AvsNeyhh7z4lx3UsCXx32c5bZReTUxy9LDUyqasEZ1zKeA4KY9kBEArog7RQUgW0zZ4B9jyRbRD91IiI7HmO6Y6iV0PcyKhBWNYRJrxAJzhqRYFWBO+O7wJzxRCH6N6jqq7MdiSdi4FuQmICqVlT12/m2MsZuH8kW0aUW65SWnKuGWaXYPZKPaZMMFGlCVAIOzJwGNggVT4ApoGl9eeDHuKuEN8CV8bqInPec5VALke9l1ATaj5G0F1GZqODq/UhwhBGGH7+MIBLuIN+7QwAAAABJRU5ErkJggg==";

function createTrayIcon(): Electron.NativeImage {
	const buffer1x = Buffer.from(TRAY_ICON_PNG_16_BASE64, "base64");
	const buffer2x = Buffer.from(TRAY_ICON_PNG_32_BASE64, "base64");
	const image1x = nativeImage.createFromBuffer(buffer1x, { scaleFactor: 1 });
	const image2x = nativeImage.createFromBuffer(buffer2x, { scaleFactor: 2 });

	const icon = nativeImage.createEmpty();
	icon.addRepresentation({ scaleFactor: 1, buffer: image1x.toPNG() });
	icon.addRepresentation({ scaleFactor: 2, buffer: image2x.toPNG() });

	if (process.platform === "darwin") {
		icon.setTemplateImage(true);
	}

	logger.info("Tray icon created", {
		isEmpty: icon.isEmpty(),
		size: icon.getSize(),
		platform: process.platform,
	});

	return icon;
}

function syncTrayTitle(): void {
	if (!tray || tray.isDestroyed() || process.platform !== "darwin") return;
	const parts: string[] = [];
	if (updateReady) parts.push("↑");
	if (unreadCount > 0) parts.push(`• ${unreadCount}`);
	tray.setTitle(parts.join(" "));
}

export function setTrayUpdateReady(ready: boolean): void {
	updateReady = ready;
	if (!tray || tray.isDestroyed()) return;
	try {
		syncTrayTitle();
	} catch (error) {
		logger.warn("Failed to update tray title for update indicator", {
			error: String(error),
		});
	}
}

export function setTrayUnreadCount(count: number): void {
	unreadCount = Math.max(0, Math.trunc(count));
	if (!tray || tray.isDestroyed()) return;
	try {
		tray.setImage(createTrayIcon());
		syncTrayTitle();
	} catch (error) {
		logger.warn("Failed to update tray icon", { error: String(error) });
	}
}

function updateTrayMenu(isPaused: boolean): void {
	if (!trayMenu) return;

	const pauseItem = trayMenu.getMenuItemById("pause");
	const resumeItem = trayMenu.getMenuItemById("resume");
	if (pauseItem) pauseItem.visible = !isPaused;
	if (resumeItem) resumeItem.visible = isPaused;
}

function getTrayDisplayId(): string {
	const bounds = tray?.getBounds();
	if (!bounds) return String(screen.getPrimaryDisplay().id);
	const point = {
		x: Math.round(bounds.x + bounds.width / 2),
		y: Math.round(bounds.y + bounds.height / 2),
	};
	return String(screen.getDisplayNearestPoint(point).id);
}

export function createTray(onQuit: () => void): Tray {
	quitCallback = onQuit;

	logger.info("Creating tray...");

	let icon: Electron.NativeImage | null = null;
	try {
		icon = createTrayIcon();
		tray = new Tray(icon);
	} catch (error) {
		logger.error("Failed to create tray", error);
		throw error;
	}

	tray.setToolTip("Screencap");

	if (
		process.platform === "darwin" &&
		process.env.NODE_ENV === "development" &&
		icon?.isEmpty()
	) {
		tray.setTitle("SC");
	} else if (process.platform === "darwin") {
		syncTrayTitle();
	}

	logger.info("Tray created", { platform: process.platform });

	trayMenu = Menu.buildFromTemplate([
		{
			label: "Open Screencap",
			click: () => showMainWindow(),
		},
		{ type: "separator" },
		{
			label: "Capture Now",
			click: () => {
				void triggerManualCaptureWithPrimaryDisplay({
					primaryDisplayId: getTrayDisplayId(),
				});
			},
		},
		{
			label: "Pause Capture",
			id: "pause",
			click: () => {
				stopScheduler();
				updateTrayMenu(true);
			},
		},
		{
			label: "Resume Capture",
			id: "resume",
			visible: false,
			click: () => {
				startScheduler();
				updateTrayMenu(false);
			},
		},
		{ type: "separator" },
		{
			label: "Quit",
			click: () => {
				quitCallback?.();
				destroyMainWindow();
				app.quit();
			},
		},
	]);

	tray.on("click", (_event, bounds) => {
		togglePopupWindow(bounds ?? tray?.getBounds());
	});

	tray.on("right-click", () => {
		tray?.popUpContextMenu(trayMenu ?? undefined);
	});

	return tray;
}

export function destroyTray(): void {
	tray?.destroy();
	tray = null;
	trayMenu = null;
}
