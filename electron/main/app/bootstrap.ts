import { app } from "electron";
import type { ClassificationEvalOptions } from "../features/aiEval";
import { runClassificationEval } from "../features/aiEval";
import { checkScreenCapturePermission } from "../features/permissions";
import { startQueueProcessor } from "../features/queue";
import { startRetentionService } from "../features/retention";
import { startScheduler } from "../features/scheduler";
import { startShortcuts } from "../features/shortcuts";
import { initializeUpdater } from "../features/update";
import { createLogger } from "../infra/log";
import { getSettings } from "../infra/settings";
import { registerAllHandlers } from "../ipc";
import { initializeDatabase } from "./database";
import {
	getIsQuitting,
	setIsQuitting,
	setupLifecycleHandlers,
} from "./lifecycle";
import {
	applyLaunchAtLoginSetting,
	shouldStartHiddenFromLaunchContext,
} from "./loginItem";
import { initPopupWindow } from "./popup";
import { registerProtocols } from "./protocol";
import { createTray } from "./tray";
import {
	createWindow,
	ensureMacDockVisible,
	getMainWindow,
	setupWindowCloseHandler,
} from "./window";

const logger = createLogger({ scope: "App" });

function parseEvalArgs(argv: string[]): ClassificationEvalOptions | null {
	if (!argv.includes("--eval-classification")) return null;

	let limit = 25;
	let strategies: ClassificationEvalOptions["strategies"] = [
		"vision",
		"text",
		"local",
	];

	for (const arg of argv) {
		const m = arg.match(/^--limit=(\d+)$/);
		if (m) {
			limit = Number(m[1]);
		}
		const s = arg.match(/^--strategies=([a-z,]+)$/);
		if (s) {
			strategies = s[1]
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean) as ClassificationEvalOptions["strategies"];
		}
	}

	return { limit, strategies };
}

export async function bootstrap(): Promise<void> {
	await app.whenReady();

	logger.info("App starting...");

	const evalArgs = parseEvalArgs(process.argv);
	if (evalArgs) {
		initializeDatabase();
		await runClassificationEval(evalArgs);
		app.quit();
		return;
	}

	registerProtocols();
	initializeDatabase();

	registerAllHandlers(getMainWindow);
	applyLaunchAtLoginSetting(getSettings().launchAtLogin);
	ensureMacDockVisible();

	const hasPermission = checkScreenCapturePermission();
	logger.info("Screen capture permission:", hasPermission);

	const startHidden = shouldStartHiddenFromLaunchContext();
	const _mainWindow = createWindow({ startHidden });
	setupWindowCloseHandler(getIsQuitting);

	createTray(() => setIsQuitting(true));
	initPopupWindow();
	startShortcuts(getSettings());

	startRetentionService();
	startQueueProcessor();

	if (hasPermission) {
		startScheduler();
	}

	initializeUpdater();

	setupLifecycleHandlers();

	logger.info("App ready");
}
