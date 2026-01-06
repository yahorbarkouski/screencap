import {
	AlertCircle,
	Bot,
	Camera,
	Check,
	Database,
	FolderOpen,
	Loader2,
	Play,
	SlidersHorizontal,
	Square,
	Users,
	Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AiSettingsTab } from "@/components/settings/AiSettingsTab";
import { AutomationTab } from "@/components/settings/AutomationTab";
import {
	SettingsRow,
	SettingsRows,
	SettingsTabHeader,
} from "@/components/settings/SettingsPrimitives";
import { ShortcutsPanel } from "@/components/settings/ShortcutsPanel";
import { SocialTab } from "@/components/settings/SocialTab";
import { StorageUsagePanel } from "@/components/settings/StorageUsagePanel";
import { SystemTab } from "@/components/settings/SystemTab";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel } from "@/components/wrapped/Panel";
import { useSettings } from "@/hooks/useSettings";
import { useAppStore } from "@/stores/app";
import type { OcrResult } from "@/types";

export function SettingsView() {
	const settingsTab = useAppStore((s) => s.settingsTab);
	const setSettingsTab = useAppStore((s) => s.setSettingsTab);
	const { settings, updateSetting, saveSettings } = useSettings();
	const [apiKey, setApiKey] = useState(settings.apiKey || "");
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState<{
		success: boolean;
		error?: string;
	} | null>(null);
	const [cloudModel, setCloudModel] = useState(settings.cloudLlmModel);
	const [localBaseUrl, setLocalBaseUrl] = useState(settings.localLlmBaseUrl);
	const [localModel, setLocalModel] = useState(settings.localLlmModel);
	const [isTestingLocal, setIsTestingLocal] = useState(false);
	const [localTestResult, setLocalTestResult] = useState<{
		success: boolean;
		error?: string;
	} | null>(null);
	const [screenshotTest, setScreenshotTest] = useState<{
		status: "idle" | "loading" | "success" | "error";
		message?: string;
		image?: string;
	}>({ status: "idle" });
	const [ocrTest, setOcrTest] = useState<{
		status: "idle" | "loading" | "success" | "error";
		message?: string;
		result?: OcrResult;
	}>({ status: "idle" });
	const [isSchedulerRunning, setIsSchedulerRunning] = useState(false);

	const handleTabChange = (value: string) => {
		if (
			value === "capture" ||
			value === "ai" ||
			value === "automation" ||
			value === "data" ||
			value === "social" ||
			value === "system"
		) {
			setSettingsTab(value);
		}
	};

	useEffect(() => {
		if (!window.api) return;

		const checkScheduler = async () => {
			const running = await window.api.scheduler.isRunning();
			setIsSchedulerRunning(running);
		};
		checkScheduler();
		const interval = setInterval(checkScheduler, 2000);
		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		setCloudModel(settings.cloudLlmModel);
		setLocalBaseUrl(settings.localLlmBaseUrl);
		setLocalModel(settings.localLlmModel);
	}, [
		settings.cloudLlmModel,
		settings.localLlmBaseUrl,
		settings.localLlmModel,
	]);

	const handleSaveCloudLlm = async () => {
		const nextCloudModel = cloudModel.trim() || "openai/gpt-5";
		const nextApiKey = apiKey.trim() ? apiKey : settings.apiKey;
		await saveSettings({
			...settings,
			apiKey: nextApiKey,
			cloudLlmModel: nextCloudModel,
		});
		setTestResult(null);
	};

	const handleTestConnection = async () => {
		if (!apiKey || !window.api) return;

		await saveSettings({
			...settings,
			apiKey,
			cloudLlmModel: cloudModel.trim() || "openai/gpt-5",
		});
		setIsTesting(true);
		setTestResult(null);

		try {
			const result = await window.api.llm.testConnection();
			setTestResult(result);
		} catch (error) {
			setTestResult({ success: false, error: String(error) });
		} finally {
			setIsTesting(false);
		}
	};

	const handleSaveLocalLlm = async () => {
		await saveSettings({
			...settings,
			localLlmBaseUrl: localBaseUrl,
			localLlmModel: localModel,
		});
		setLocalTestResult(null);
	};

	const handleTestLocalLlm = async () => {
		if (!window.api) return;
		await saveSettings({
			...settings,
			localLlmBaseUrl: localBaseUrl,
			localLlmModel: localModel,
		});
		setIsTestingLocal(true);
		setLocalTestResult(null);
		try {
			const result = await window.api.llm.testLocalConnection();
			setLocalTestResult(result);
		} catch (error) {
			setLocalTestResult({ success: false, error: String(error) });
		} finally {
			setIsTestingLocal(false);
		}
	};

	const handleTestScreenshot = async () => {
		if (!window.api) return;
		setScreenshotTest({ status: "loading" });
		try {
			const imageBase64 = await window.api.capture.primary();
			if (imageBase64) {
				setScreenshotTest({
					status: "success",
					message: `Screenshot captured! Size: ${Math.round(imageBase64.length / 1024)} KB`,
					image: imageBase64,
				});
			} else {
				setScreenshotTest({
					status: "error",
					message:
						"No screenshot returned. Permission might be denied or no displays found.",
				});
			}
		} catch (error) {
			setScreenshotTest({
				status: "error",
				message: `Error: ${error}`,
			});
		}
	};

	const handleTestOcr = async () => {
		if (!window.api) return;
		setOcrTest({ status: "loading" });
		try {
			const imageBase64 = await window.api.capture.primary();
			if (!imageBase64) {
				setOcrTest({
					status: "error",
					message:
						"No screenshot returned. Permission might be denied or no displays found.",
				});
				return;
			}
			const result = await window.api.ocr.recognize(imageBase64);
			setOcrTest({
				status: "success",
				message: `OCR extracted ${result.lines.length} lines`,
				result,
			});
		} catch (error) {
			setOcrTest({ status: "error", message: String(error) });
		}
	};

	const handleStartScheduler = async () => {
		await window.api.scheduler.start(settings.captureInterval);
		setIsSchedulerRunning(true);
		setScreenshotTest({
			status: "success",
			message: `Auto-capture started! Interval: every ${settings.captureInterval} min`,
		});
	};

	const handleStopScheduler = async () => {
		await window.api.scheduler.stop();
		setIsSchedulerRunning(false);
		setScreenshotTest({ status: "idle" });
	};

	const handleIntervalChange = async (value: string) => {
		const nextIntervalMinutes = Number.parseInt(value, 10);
		await updateSetting("captureInterval", nextIntervalMinutes);
		if (isSchedulerRunning) {
			setScreenshotTest({
				status: "success",
				message: `Auto-capture interval updated! Now every ${nextIntervalMinutes} min`,
			});
		}
	};

	const handleRetentionChange = async (value: string) => {
		await updateSetting("retentionDays", parseInt(value, 10));
	};

	const tabTriggerClassName =
		"shrink-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-0";

	const handleRevealInFinder = async () => {
		if (!window.api) return;
		await window.api.app.revealInFinder();
	};

	return (
		<div className="h-full flex flex-col">
			<div className="drag-region flex flex-col border-b border-border p-2 px-4">
				<h1 className="text-lg font-semibold">Settings</h1>
				<p className="text-sm text-muted-foreground">
					Configure Screencap preferences
				</p>
			</div>

			<Tabs
				value={settingsTab}
				onValueChange={handleTabChange}
				className="flex-1 flex flex-col min-h-0"
			>
				<div className="shrink-0 border-b border-border overflow-x-auto scrollbar-gutter-stable">
					<TabsList className="h-12 w-max bg-transparent px-4 gap-4 justify-start">
						<TabsTrigger value="capture" className={tabTriggerClassName}>
							<Camera className="h-4 w-4 mr-2" />
							Capture
						</TabsTrigger>
						<TabsTrigger value="ai" className={tabTriggerClassName}>
							<Bot className="h-4 w-4 mr-2" />
							AI
						</TabsTrigger>
						<TabsTrigger value="automation" className={tabTriggerClassName}>
							<Workflow className="h-4 w-4 mr-2" />
							Automation
						</TabsTrigger>
						<TabsTrigger value="data" className={tabTriggerClassName}>
							<Database className="h-4 w-4 mr-2" />
							Data
						</TabsTrigger>
						<TabsTrigger value="social" className={tabTriggerClassName}>
							<Users className="h-4 w-4 mr-2" />
							Social
						</TabsTrigger>
						<TabsTrigger value="system" className={tabTriggerClassName}>
							<SlidersHorizontal className="h-4 w-4 mr-2" />
							System
						</TabsTrigger>
					</TabsList>
				</div>

				<ScrollArea className="flex-1">
					<TabsContent value="capture" className="p-6 m-0">
						<div className="space-y-6">
							<SettingsTabHeader
								title="Capture"
								description="Schedule screenshots and validate capture permissions"
							/>

							<Panel
								title="Schedule"
								meta="Automatic screenshot capture"
								className="max-w-3xl"
								right={
									<div className="flex items-center gap-2">
										<div className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-xs text-muted-foreground">
											<div
												className={`h-2 w-2 rounded-full ${
													isSchedulerRunning
														? "bg-accent"
														: "bg-muted-foreground"
												}`}
											/>
											<span className="text-foreground/90">
												{isSchedulerRunning ? "Running" : "Stopped"}
											</span>
										</div>
										{!isSchedulerRunning ? (
											<Button
												size="sm"
												variant="outline"
												className="border-accent/40 text-accent hover:bg-accent/10"
												onClick={handleStartScheduler}
											>
												<Play className="h-4 w-4 mr-2" />
												Start
											</Button>
										) : (
											<Button
												size="sm"
												variant="outline"
												className="border-destructive/40 text-destructive hover:bg-destructive/10"
												onClick={handleStopScheduler}
											>
												<Square className="h-4 w-4 mr-2" />
												Stop
											</Button>
										)}
									</div>
								}
							>
								<SettingsRows>
									<SettingsRow
										title="Capture interval"
										description="How often to capture screenshots (shorter intervals use more storage)"
										right={
											<Select
												value={String(settings.captureInterval)}
												onValueChange={handleIntervalChange}
											>
												<SelectTrigger className="h-8 text-sm w-full sm:w-[220px]">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="1" className="text-sm">
														Every 1 minute
													</SelectItem>
													<SelectItem value="2" className="text-sm">
														Every 2 minutes
													</SelectItem>
													<SelectItem value="5" className="text-sm">
														Every 5 minutes
													</SelectItem>
													<SelectItem value="10" className="text-sm">
														Every 10 minutes
													</SelectItem>
													<SelectItem value="15" className="text-sm">
														Every 15 minutes
													</SelectItem>
													<SelectItem value="30" className="text-sm">
														Every 30 minutes
													</SelectItem>
												</SelectContent>
											</Select>
										}
									/>
								</SettingsRows>
							</Panel>

							<Panel
								title="Manual capture"
								meta="Capture now or validate permissions"
								className="max-w-3xl"
								right={
									<Button
										variant="outline"
										onClick={handleTestScreenshot}
										disabled={screenshotTest.status === "loading"}
										size="sm"
									>
										<Camera className="h-4 w-4" />
										Test Capture
									</Button>
								}
							>
								<div className="space-y-3">
									{screenshotTest.status === "loading" && (
										<div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-muted-foreground">
											<Loader2 className="h-4 w-4 animate-spin" />
											<span className="text-sm">
												{screenshotTest.message || "Working..."}
											</span>
										</div>
									)}

									{screenshotTest.status === "success" && (
										<div className="space-y-2">
											<div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-500">
												<Check className="h-4 w-4" />
												<span className="text-sm">
													{screenshotTest.message}
												</span>
											</div>
											{screenshotTest.image ? (
												<div className="rounded-lg overflow-hidden border border-border">
													<img
														src={`data:image/webp;base64,${screenshotTest.image}`}
														alt="Screenshot preview"
														className="w-full"
													/>
												</div>
											) : null}
										</div>
									)}

									{screenshotTest.status === "error" && (
										<div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
											<AlertCircle className="h-4 w-4" />
											<span className="text-sm">{screenshotTest.message}</span>
										</div>
									)}
								</div>
							</Panel>

							<ShortcutsPanel
								shortcuts={settings.shortcuts}
								onChange={(next) => {
									void updateSetting("shortcuts", next);
								}}
							/>

							<Panel
								title="Day Wrapped"
								meta="Visualization preferences"
								className="max-w-3xl"
							>
								<SettingsRows>
									<SettingsRow
										title="Show websites instead of browsers"
										description="When enabled, shows the dominant website (e.g. github.com) instead of the browser app (e.g. Safari) in apps view"
										right={
											<Switch
												checked={settings.showDominantWebsites}
												onCheckedChange={(checked) =>
													updateSetting("showDominantWebsites", checked)
												}
											/>
										}
									/>
								</SettingsRows>
							</Panel>
						</div>
					</TabsContent>

					<AiSettingsTab
						settings={settings}
						updateSetting={updateSetting}
						apiKey={apiKey}
						setApiKey={setApiKey}
						cloudModel={cloudModel}
						setCloudModel={setCloudModel}
						isTesting={isTesting}
						testResult={testResult}
						onTestConnection={handleTestConnection}
						onSaveCloudLlm={handleSaveCloudLlm}
						localBaseUrl={localBaseUrl}
						setLocalBaseUrl={setLocalBaseUrl}
						localModel={localModel}
						setLocalModel={setLocalModel}
						isTestingLocal={isTestingLocal}
						localTestResult={localTestResult}
						onSaveLocalLlm={handleSaveLocalLlm}
						onTestLocalLlm={handleTestLocalLlm}
						ocrTest={ocrTest}
						onTestOcr={handleTestOcr}
					/>

					<AutomationTab settings={settings} saveSettings={saveSettings} />

					<SocialTab settings={settings} updateSetting={updateSetting} />

					<TabsContent value="data" className="p-6 m-0">
						<div className="space-y-6">
							<SettingsTabHeader
								title="Data"
								description="Control retention and review privacy guarantees"
							/>

							<Panel
								title="Storage"
								meta="Retention policy"
								className="max-w-3xl"
							>
								<SettingsRows>
									<SettingsRow
										title="Storage location"
										description="Contains screenshots, database, and settings"
										right={
											<Button
												variant="outline"
												size="sm"
												onClick={handleRevealInFinder}
											>
												<FolderOpen className="h-4 w-4 mr-2" />
												Reveal in Finder
											</Button>
										}
									/>
									<SettingsRow
										title="Retention period"
										description="Screenshots older than this will be automatically deleted"
										right={
											<Select
												value={String(settings.retentionDays)}
												onValueChange={handleRetentionChange}
											>
												<SelectTrigger className="h-8 w-full sm:w-[220px]">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="7">7 days</SelectItem>
													<SelectItem value="14">14 days</SelectItem>
													<SelectItem value="30">30 days</SelectItem>
													<SelectItem value="60">60 days</SelectItem>
													<SelectItem value="90">90 days</SelectItem>
													<SelectItem value="365">1 year</SelectItem>
												</SelectContent>
											</Select>
										}
									/>
								</SettingsRows>
							</Panel>

							<StorageUsagePanel />
						</div>
					</TabsContent>

					<SystemTab
						settings={settings}
						updateSetting={updateSetting}
						saveSettings={saveSettings}
					/>
				</ScrollArea>
			</Tabs>
		</div>
	);
}
