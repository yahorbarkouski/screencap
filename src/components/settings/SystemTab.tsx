import {
	AlertCircle,
	Bug,
	Check,
	Copy,
	Download,
	ExternalLink,
	Eye,
	FileText,
	Loader2,
	RefreshCw,
	RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getRendererLogs, getRendererLogCount } from "@/lib/rendererLogBuffer";
import {
	SettingsRow,
	SettingsRows,
	SettingsTabHeader,
} from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Panel } from "@/components/wrapped/Panel";
import { cn } from "@/lib/utils";
import type {
	AppInfo,
	ContextStatus,
	ContextTestResult,
	Settings,
	UpdateState,
} from "@/types";

interface SystemTabProps {
	settings: Settings;
	updateSetting: <K extends keyof Settings>(
		key: K,
		value: Settings[K],
	) => Promise<void>;
	saveSettings: (settings: Settings) => Promise<void>;
}

type PermissionStatusType = "granted" | "denied" | "not-determined";

function PermissionItem({
	label,
	description,
	status,
}: {
	label: string;
	description?: string;
	status: PermissionStatusType;
}) {
	const colors = {
		granted: "bg-green-500/20 text-green-600 dark:text-green-400",
		denied: "bg-red-500/20 text-red-600 dark:text-red-400",
		"not-determined": "bg-amber-500/20 text-amber-600 dark:text-amber-400",
	};
	const labels = {
		granted: "Granted",
		denied: "Denied",
		"not-determined": "Not Set",
	};

	return (
		<div className="flex items-center justify-between py-3 first:pt-0 last:pb-0 border-b border-border/40 last:border-0">
			<div className="space-y-0.5">
				<p className="text-sm font-medium">{label}</p>
				{description && (
					<p className="text-xs text-muted-foreground">{description}</p>
				)}
			</div>
			<span className={cn("text-xs px-2.5 py-1 rounded-full", colors[status])}>
				{labels[status]}
			</span>
		</div>
	);
}

function UpdateStatusBadge({ state }: { state: UpdateState | null }) {
	if (!state) {
		return (
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
				Loading...
			</div>
		);
	}

	const configs: Record<
		string,
		{ icon: React.ReactNode; text: string; className: string }
	> = {
		idle: {
			icon: <RefreshCw className="h-4 w-4" />,
			text: "Ready to check",
			className: "text-muted-foreground",
		},
		checking: {
			icon: <Loader2 className="h-4 w-4 animate-spin" />,
			text: "Checking for updates...",
			className: "text-muted-foreground",
		},
		not_available: {
			icon: <Check className="h-4 w-4" />,
			text: "You're up to date",
			className: "text-green-600 dark:text-green-400",
		},
		available: {
			icon: <Download className="h-4 w-4" />,
			text: `Update available: v${state.availableVersion}`,
			className: "text-blue-600 dark:text-blue-400",
		},
		downloading: {
			icon: <Loader2 className="h-4 w-4 animate-spin" />,
			text: "Downloading...",
			className: "text-muted-foreground",
		},
		downloaded: {
			icon: <Check className="h-4 w-4" />,
			text: "Ready to install",
			className: "text-green-600 dark:text-green-400",
		},
		error: {
			icon: <AlertCircle className="h-4 w-4" />,
			text: state.error?.message || "Update failed",
			className: "text-destructive",
		},
	};

	const config = configs[state.status] ?? configs.idle;

	return (
		<div className={cn("flex items-center gap-2 text-sm", config.className)}>
			{config.icon}
			<span>{config.text}</span>
		</div>
	);
}

function ContextTestResultDisplay({
	status,
	result,
}: {
	status: "idle" | "loading" | "success" | "error";
	result?: ContextTestResult;
}) {
	if (status === "idle") return null;

	if (status === "loading") {
		return (
			<div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" />
				<span className="text-sm">Detecting context...</span>
			</div>
		);
	}

	if (status === "error" || !result?.success) {
		return (
			<div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
				<AlertCircle className="h-4 w-4 shrink-0" />
				<span className="text-sm">
					{result?.error || "Failed to detect context"}
				</span>
			</div>
		);
	}

	return (
		<div className="p-3 rounded-lg bg-green-500/10 space-y-2">
			<div className="flex items-center gap-2 text-green-600 dark:text-green-400">
				<Check className="h-4 w-4" />
				<span className="text-sm font-medium">Context detected</span>
			</div>
			<div className="grid gap-1.5 text-xs text-muted-foreground">
				<div className="flex justify-between">
					<span>App</span>
					<span className="font-mono text-foreground/80">
						{result.appName} ({result.appBundleId})
					</span>
				</div>
				<div className="flex justify-between">
					<span>Window</span>
					<span className="font-mono text-foreground/80 truncate max-w-[200px]">
						{result.windowTitle || "—"}
					</span>
				</div>
				{result.urlHost && (
					<div className="flex justify-between">
						<span>Host</span>
						<span className="font-mono text-foreground/80">
							{result.urlHost}
						</span>
					</div>
				)}
				<div className="flex justify-between">
					<span>Provider</span>
					<span className="font-mono text-foreground/80">
						{result.provider} ({((result.confidence ?? 0) * 100).toFixed(0)}%)
					</span>
				</div>
			</div>
		</div>
	);
}

export function SystemTab({
	settings,
	updateSetting,
	saveSettings,
}: SystemTabProps) {
	const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
	const [updateState, setUpdateState] = useState<UpdateState | null>(null);
	const [contextStatus, setContextStatus] = useState<ContextStatus | null>(
		null,
	);
	const [contextTest, setContextTest] = useState<{
		status: "idle" | "loading" | "success" | "error";
		result?: ContextTestResult;
	}>({ status: "idle" });
	const [copiedSha, setCopiedSha] = useState(false);
	const [logsAction, setLogsAction] = useState<{
		status: "idle" | "copying" | "saving" | "copied" | "saved" | "error";
		message?: string;
	}>({ status: "idle" });

	useEffect(() => {
		if (!window.api) return;

		const loadData = async () => {
			const [info, state, status] = await Promise.all([
				window.api.app.getInfo(),
				window.api.update.getState(),
				window.api.context.getStatus(),
			]);
			setAppInfo(info);
			setUpdateState(state);
			setContextStatus(status);
		};

		loadData();

		const interval = setInterval(async () => {
			const status = await window.api.context.getStatus();
			setContextStatus(status);
		}, 2000);

		const unsubscribe = window.api.on("update:state", (state) => {
			setUpdateState(state as UpdateState);
		});

		return () => {
			clearInterval(interval);
			unsubscribe();
		};
	}, []);

	const handleTestContextDetection = useCallback(async () => {
		if (!window.api) return;
		setContextTest({ status: "loading" });
		try {
			const result = await window.api.context.test();
			setContextTest({
				status: result.success ? "success" : "error",
				result,
			});
		} catch (error) {
			setContextTest({
				status: "error",
				result: {
					success: false,
					appName: null,
					appBundleId: null,
					windowTitle: null,
					isFullscreen: false,
					urlHost: null,
					contentKind: null,
					contentId: null,
					contentTitle: null,
					contextKey: null,
					provider: null,
					confidence: null,
					error: String(error),
				},
			});
		}
	}, []);

	const handleRestartOnboarding = useCallback(async () => {
		await saveSettings({
			...settings,
			onboarding: {
				...settings.onboarding,
				completedAt: null,
			},
		});
		window.location.reload();
	}, [settings, saveSettings]);

	const handleCopySha = useCallback(() => {
		if (!appInfo?.gitSha) return;
		navigator.clipboard.writeText(appInfo.gitSha);
		setCopiedSha(true);
		setTimeout(() => setCopiedSha(false), 2000);
	}, [appInfo?.gitSha]);

	const handleCopyLogs = useCallback(async () => {
		if (!window.api) return;
		setLogsAction({ status: "copying" });
		try {
			const rendererLogs = getRendererLogs();
			await window.api.logs.copyToClipboard(rendererLogs);
			setLogsAction({ status: "copied", message: "Logs copied to clipboard" });
			setTimeout(() => setLogsAction({ status: "idle" }), 3000);
		} catch (error) {
			setLogsAction({
				status: "error",
				message: String(error),
			});
		}
	}, []);

	const handleSaveLogs = useCallback(async () => {
		if (!window.api) return;
		setLogsAction({ status: "saving" });
		try {
			const rendererLogs = getRendererLogs();
			const filePath = await window.api.logs.saveToFile(rendererLogs);
			if (filePath) {
				setLogsAction({ status: "saved", message: `Saved to ${filePath}` });
			} else {
				setLogsAction({ status: "idle" });
			}
			setTimeout(() => setLogsAction({ status: "idle" }), 3000);
		} catch (error) {
			setLogsAction({
				status: "error",
				message: String(error),
			});
		}
	}, []);

	const launchAtLoginSupported =
		appInfo?.platform === "darwin" || appInfo?.platform === "win32";
	const launchAtLoginDisabled = !appInfo?.isPackaged || !launchAtLoginSupported;
	const launchAtLoginDescription = !appInfo
		? "Loading..."
		: !launchAtLoginSupported
			? "Not supported on this platform"
			: !appInfo.isPackaged
				? "Available in packaged builds only"
				: "Automatically start when you log in";

	return (
		<TabsContent value="system" className="p-6 m-0">
			<div className="space-y-6">
				<SettingsTabHeader
					title="System"
					description="Permissions, updates, and app configuration"
				/>

				<Panel title="General" meta="Startup behavior" className="max-w-3xl">
					<SettingsRows>
						<SettingsRow
							title="Launch at login"
							description={launchAtLoginDescription}
							right={
								<Switch
									checked={settings.launchAtLogin}
									disabled={launchAtLoginDisabled}
									onCheckedChange={(checked) =>
										updateSetting("launchAtLogin", checked)
									}
								/>
							}
						/>
					</SettingsRows>
				</Panel>

				<Panel
					title="Permissions"
					meta="Required for context detection"
					className="max-w-3xl"
					right={
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={() =>
									window.api.permissions.openAccessibilitySettings()
								}
							>
								<ExternalLink className="size-3" />
								Accessibility
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="h-7 text-xs"
								onClick={() => window.api.permissions.openAutomationSettings()}
							>
								<ExternalLink className="w-3 h-3" />
								Automation
							</Button>
						</div>
					}
				>
					{contextStatus ? (
						<div className="space-y-0">
							<PermissionItem
								label="Screen Recording"
								description="Capture screenshots of your displays"
								status={contextStatus.screenCapture}
							/>
							<PermissionItem
								label="Accessibility"
								description="Detect foreground app and window title"
								status={contextStatus.accessibility}
							/>
							<PermissionItem
								label="Automation (System Events)"
								description="Access system-level window information"
								status={contextStatus.automation.systemEvents}
							/>
							<PermissionItem
								label="Automation (Browsers)"
								description="Extract URLs from Safari, Chrome, Brave, Edge"
								status={contextStatus.automation.browsers}
							/>
							<PermissionItem
								label="Automation (Apps)"
								description="Read content info from apps like Spotify"
								status={contextStatus.automation.apps}
							/>
						</div>
					) : (
						<div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading permissions...
						</div>
					)}
				</Panel>

				<Panel
					title="Diagnostics"
					meta="Validate context detection"
					className="max-w-3xl"
					right={
						<Button
							variant="outline"
							size="sm"
							className="h-8"
							onClick={handleTestContextDetection}
							disabled={contextTest.status === "loading"}
						>
							{contextTest.status === "loading" ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Eye className="h-4 w-4" />
							)}
							Test Detection
						</Button>
					}
				>
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							Test whether Screencap can detect the current foreground app,
							window title, and browser URL. Open a browser or app before
							testing.
						</p>
						<ContextTestResultDisplay
							status={contextTest.status}
							result={contextTest.result}
						/>
					</div>
				</Panel>

				<Panel
					title="Troubleshooting"
					meta="Share diagnostic logs"
					className="max-w-3xl"
					right={
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								className="h-8"
								onClick={handleCopyLogs}
								disabled={
									logsAction.status === "copying" ||
									logsAction.status === "saving"
								}
							>
								{logsAction.status === "copying" ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : logsAction.status === "copied" ? (
									<Check className="h-4 w-4 text-green-500" />
								) : (
									<Copy className="h-4 w-4" />
								)}
								Copy
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="h-8"
								onClick={handleSaveLogs}
								disabled={
									logsAction.status === "copying" ||
									logsAction.status === "saving"
								}
							>
								{logsAction.status === "saving" ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : logsAction.status === "saved" ? (
									<Check className="h-4 w-4 text-green-500" />
								) : (
									<FileText className="h-4 w-4" />
								)}
								Save
							</Button>
						</div>
					}
				>
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							If you're experiencing issues, export diagnostic logs to share
							with support. Logs include system info and recent activity (no
							screenshots or personal data).
						</p>
						{logsAction.status === "copied" && (
							<div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
								<Check className="h-4 w-4" />
								<span className="text-sm">{logsAction.message}</span>
							</div>
						)}
						{logsAction.status === "saved" && logsAction.message && (
							<div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
								<Check className="h-4 w-4" />
								<span className="text-sm font-mono truncate">
									{logsAction.message}
								</span>
							</div>
						)}
						{logsAction.status === "error" && (
							<div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
								<AlertCircle className="h-4 w-4 shrink-0" />
								<span className="text-sm">{logsAction.message}</span>
							</div>
						)}
						<div className="text-xs text-muted-foreground">
							<Bug className="inline h-3 w-3 mr-1" />
							{getRendererLogCount()} renderer logs buffered
						</div>
					</div>
				</Panel>

				<Panel
					title="Updates"
					meta={
						updateState?.lastCheckedAt
							? `Last checked ${new Date(updateState.lastCheckedAt).toLocaleDateString()}`
							: "Keep Screencap up to date"
					}
					className="max-w-3xl"
				>
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<UpdateStatusBadge state={updateState} />
							<div className="flex items-center gap-2">
								{updateState?.status === "downloaded" ? (
									<Button
										size="sm"
										onClick={() => window.api.update.restartAndInstall()}
									>
										<RotateCcw className="h-4 w-4 mr-2" />
										Restart to Update
									</Button>
								) : updateState?.status === "available" ? (
									<Button
										size="sm"
										onClick={() => window.api.update.download()}
									>
										<Download className="h-4 w-4 mr-2" />
										Download
									</Button>
								) : (
									<Button
										variant="outline"
										size="sm"
										onClick={() => window.api.update.check()}
										disabled={
											updateState?.status === "checking" ||
											updateState?.status === "downloading"
										}
									>
										<RefreshCw
											className={cn(
												"w-1 h-1",
												updateState?.status === "checking" && "animate-spin",
											)}
										/>
										Check
									</Button>
								)}
							</div>
						</div>

						{updateState?.status === "downloading" && updateState.progress && (
							<div className="space-y-1.5">
								<div className="w-full bg-muted rounded-full h-1.5">
									<div
										className="bg-primary h-1.5 rounded-full transition-all"
										style={{ width: `${updateState.progress.percent}%` }}
									/>
								</div>
								<p className="text-xs text-muted-foreground text-right">
									{updateState.progress.percent.toFixed(0)}%
								</p>
							</div>
						)}
					</div>
				</Panel>

				<Panel title="About" className="max-w-3xl">
					{appInfo ? (
						<div className="space-y-4">
							<div className="flex items-start justify-between">
								<div>
									<h3 className="text-xl font-semibold">Screencap</h3>
									<p className="text-sm text-muted-foreground mt-1">
										Screen activity tracker with AI-powered classification
									</p>
								</div>
								<div className="text-right">
									<span className="inline-flex text-sm items-center px-2.5 py-1 rounded-md bg-muted font-mono">
										v{appInfo.version}
									</span>
								</div>
							</div>

							<div className="grid gap-2 text-xs">
								<div className="flex items-center justify-between py-2 border-t border-border/40">
									<span className="text-muted-foreground">Runtime</span>
									<span className="font-mono text-foreground/80">
										Electron {appInfo.electron} · Chrome {appInfo.chrome} · Node{" "}
										{appInfo.node}
									</span>
								</div>
								<div className="flex items-center justify-between py-2 border-t border-border/40">
									<span className="text-muted-foreground">Platform</span>
									<span className="font-mono text-foreground/80">
										{appInfo.platform} {appInfo.arch} · macOS{" "}
										{appInfo.osVersion}
									</span>
								</div>
								{appInfo.buildDate && (
									<div className="flex items-center justify-between py-2 border-t border-border/40">
										<span className="text-muted-foreground">Build date</span>
										<span className="font-mono text-foreground/80">
											{appInfo.buildDate}
										</span>
									</div>
								)}
								{appInfo.gitSha && (
									<div className="flex items-center justify-between py-2 border-t border-border/40">
										<span className="text-muted-foreground">Commit</span>
										<button
											type="button"
											onClick={handleCopySha}
											className="inline-flex items-center gap-1.5 font-mono text-foreground/80 hover:text-foreground transition-colors"
										>
											{copiedSha ? (
												<Check className="h-3 w-3 text-green-500" />
											) : (
												<Copy className="h-3 w-3" />
											)}
											{appInfo.gitSha.slice(0, 7)}
										</button>
									</div>
								)}
							</div>

							<div className="pt-2 border-t border-border/40">
								<Button
									variant="ghost"
									size="sm"
									className="h-8 text-xs text-muted-foreground hover:text-foreground"
									onClick={handleRestartOnboarding}
								>
									<RotateCcw className="size-3" />
									Restart onboarding wizard
								</Button>
							</div>
						</div>
					) : (
						<div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading app info...
						</div>
					)}
				</Panel>
			</div>
		</TabsContent>
	);
}
