interface RendererLogEntry {
	timestamp: string;
	level: string;
	message: string;
	data?: unknown;
}

const MAX_BUFFER_SIZE = 500;
const logBuffer: RendererLogEntry[] = [];

const originalConsole = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
};

function appendLog(level: string, args: unknown[]): void {
	const message = args
		.map((arg) =>
			typeof arg === "string" ? arg : JSON.stringify(arg, null, 2),
		)
		.join(" ");

	logBuffer.push({
		timestamp: new Date().toISOString(),
		level,
		message,
	});

	if (logBuffer.length > MAX_BUFFER_SIZE) {
		logBuffer.shift();
	}
}

export function initRendererLogCapture(): void {
	console.log = (...args: unknown[]) => {
		appendLog("log", args);
		originalConsole.log(...args);
	};

	console.info = (...args: unknown[]) => {
		appendLog("info", args);
		originalConsole.info(...args);
	};

	console.warn = (...args: unknown[]) => {
		appendLog("warn", args);
		originalConsole.warn(...args);
	};

	console.error = (...args: unknown[]) => {
		appendLog("error", args);
		originalConsole.error(...args);
	};
}

export function getRendererLogs(): string {
	return logBuffer
		.map(
			(entry) =>
				`[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`,
		)
		.join("\n");
}

export function getRendererLogCount(): number {
	return logBuffer.length;
}
