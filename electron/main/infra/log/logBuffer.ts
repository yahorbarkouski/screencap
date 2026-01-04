interface LogEntry {
	timestamp: string;
	level: string;
	scope: string;
	message: string;
	data?: unknown;
}

const MAX_BUFFER_SIZE = 1000;
const logBuffer: LogEntry[] = [];

export function appendLog(entry: LogEntry): void {
	logBuffer.push(entry);
	if (logBuffer.length > MAX_BUFFER_SIZE) {
		logBuffer.shift();
	}
}

export function getLogBuffer(): LogEntry[] {
	return [...logBuffer];
}

export function clearLogBuffer(): void {
	logBuffer.length = 0;
}

export function formatLogsForExport(entries: LogEntry[]): string {
	return entries
		.map((entry) => {
			const dataStr =
				entry.data !== undefined
					? ` ${JSON.stringify(entry.data, null, 2)}`
					: "";
			return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${dataStr}`;
		})
		.join("\n");
}
