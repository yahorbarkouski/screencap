import { appendLog } from "./logBuffer";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerOptions {
	scope: string;
	minLevel?: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

function getMinLevel(): LogLevel {
	const env = process.env.LOG_LEVEL?.toLowerCase();
	if (env && env in LOG_LEVELS) {
		return env as LogLevel;
	}
	return process.env.NODE_ENV === "development" ? "debug" : "info";
}

function formatTimestamp(): string {
	return new Date().toISOString();
}

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

export interface Logger {
	debug: (message: string, data?: unknown) => void;
	info: (message: string, data?: unknown) => void;
	warn: (message: string, data?: unknown) => void;
	error: (message: string, data?: unknown) => void;
}

export function createLogger(options: LoggerOptions): Logger {
	const { scope } = options;
	const minLevel = options.minLevel ?? getMinLevel();

	const log = (level: LogLevel, message: string, data?: unknown): void => {
		const timestamp = formatTimestamp();

		appendLog({
			timestamp,
			level,
			scope,
			message,
			data,
		});

		if (!shouldLog(level, minLevel)) return;

		const prefix = `[${timestamp}] [${scope}]`;
		const fullMessage = `${prefix} ${message}`;

		const logFn =
			level === "error"
				? console.error
				: level === "warn"
					? console.warn
					: console.log;

		if (data !== undefined) {
			logFn(fullMessage, data);
		} else {
			logFn(fullMessage);
		}
	};

	return {
		debug: (message, data) => log("debug", message, data),
		info: (message, data) => log("info", message, data),
		warn: (message, data) => log("warn", message, data),
		error: (message, data) => log("error", message, data),
	};
}
