import {
	AlertCircle,
	Check,
	Copy,
	ExternalLink,
	EyeIcon,
	Loader2,
} from "lucide-react";
import { useState } from "react";
import {
	SettingsRow,
	SettingsRows,
	SettingsTabHeader,
} from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Panel } from "@/components/wrapped/Panel";
import { cn } from "@/lib/utils";
import type { OcrResult, Settings } from "@/types";

const MCP_CONFIG = {
	mcpServers: {
		screencap: {
			command: "/usr/bin/env",
			args: [
				"-u",
				"ELECTRON_RUN_AS_NODE",
				"/Applications/Screencap.app/Contents/MacOS/Screencap",
				"--mcp",
			],
		},
	},
};

type ConnectionTestResult = { success: boolean; error?: string };

type OcrTestState = {
	status: "idle" | "loading" | "success" | "error";
	message?: string;
	result?: OcrResult;
};

export function AiSettingsTab({
	settings,
	updateSetting,
	apiKey,
	setApiKey,
	cloudModel,
	setCloudModel,
	isTesting,
	testResult,
	onTestConnection,
	onSaveCloudLlm,
	localBaseUrl,
	setLocalBaseUrl,
	localModel,
	setLocalModel,
	isTestingLocal,
	localTestResult,
	onSaveLocalLlm,
	onTestLocalLlm,
	ocrTest,
	onTestOcr,
}: {
	settings: Settings;
	updateSetting: <K extends keyof Settings>(
		key: K,
		value: Settings[K],
	) => Promise<void>;
	apiKey: string;
	setApiKey: (value: string) => void;
	cloudModel: string;
	setCloudModel: (value: string) => void;
	isTesting: boolean;
	testResult: ConnectionTestResult | null;
	onTestConnection: () => Promise<void>;
	onSaveCloudLlm: () => Promise<void>;
	localBaseUrl: string;
	setLocalBaseUrl: (value: string) => void;
	localModel: string;
	setLocalModel: (value: string) => void;
	isTestingLocal: boolean;
	localTestResult: ConnectionTestResult | null;
	onSaveLocalLlm: () => Promise<void>;
	onTestLocalLlm: () => Promise<void>;
	ocrTest: OcrTestState;
	onTestOcr: () => Promise<void>;
}) {
	return (
		<TabsContent value="ai" className="p-6 m-0">
			<div className="space-y-6">
				<SettingsTabHeader
					title="AI"
					description="Configure screenshot classification and local OCR"
				/>

				{!settings.llmEnabled ? (
					<div className="max-w-3xl rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
						AI classification is currently disabled. Screenshots are still
						captured locally, but won’t be processed by a model.
					</div>
				) : null}

				<Panel
					title="Classification"
					meta="Categorize screenshots automatically"
					className="max-w-3xl"
				>
					<SettingsRows>
						<SettingsRow
							title="Enable AI classification"
							description="Use a model to categorize screenshots"
							right={
								<Switch
									checked={settings.llmEnabled}
									onCheckedChange={(checked) =>
										updateSetting("llmEnabled", checked)
									}
								/>
							}
						/>
						<SettingsRow
							title="Allow vision uploads"
							description="When enabled, screenshots may be uploaded for vision-based classification (more accurate, less private)"
							right={
								<Switch
									checked={settings.allowVisionUploads}
									disabled={!settings.llmEnabled}
									onCheckedChange={(checked) =>
										updateSetting("allowVisionUploads", checked)
									}
								/>
							}
						/>
						<SettingsRow
							title="Auto-detect project progress"
							description="When enabled, AI will automatically mark screenshots as project progress. Otherwise, use 'Capture as progress' shortcut or mark manually."
							right={
								<Switch
									checked={settings.autoDetectProgress}
									disabled={!settings.llmEnabled}
									onCheckedChange={(checked) =>
										updateSetting("autoDetectProgress", checked)
									}
								/>
							}
						/>
					</SettingsRows>
				</Panel>

				<Panel
					title="Cloud LLM"
					meta=""
					className="max-w-3xl"
					right={
						<a
							href="https://openrouter.ai/keys"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Keys
						</a>
					}
				>
					<div className="space-y-3">
						<div className="grid gap-2 sm:grid-cols-2">
							<div className="space-y-1">
								<div className="text-xs text-muted-foreground">
									API key (OpenRouter / OpenAI-compatible)
								</div>
								<Input
									type="password"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder="sk-or-..."
								/>
							</div>
							<div className="space-y-1">
								<div className="text-xs text-muted-foreground">Model</div>
								<Input
									value={cloudModel}
									onChange={(e) => setCloudModel(e.target.value)}
									placeholder="openai/gpt-5"
								/>
							</div>
						</div>

						<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
							<Button
								variant="outline"
								size="sm"
								onClick={onSaveCloudLlm}
								className="sm:w-[96px]"
							>
								Save
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onClick={onTestConnection}
								disabled={!apiKey || isTesting}
								className="sm:w-[96px]"
							>
								{isTesting ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									"Test"
								)}
							</Button>
							<div className="text-xs text-muted-foreground">
								Controls the model used for cloud classification (text +
								vision).
							</div>
						</div>

						{testResult ? (
							<ConnectionBanner
								result={testResult}
								successLabel="Connection successful!"
								failureLabelPrefix="Connection failed: "
							/>
						) : null}
					</div>
				</Panel>

				<Panel
					title="Local LLM"
					meta="Ollama / LM Studio"
					className="max-w-3xl"
				>
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-3">
							<div className="text-sm font-medium">Enable local LLM</div>
							<Switch
								checked={settings.localLlmEnabled}
								onCheckedChange={(checked) =>
									updateSetting("localLlmEnabled", checked)
								}
							/>
						</div>

						<div
							className={cn(
								"space-y-3",
								!settings.localLlmEnabled && "opacity-60 pointer-events-none",
							)}
						>
							<div className="grid gap-2 sm:grid-cols-2">
								<div className="space-y-1">
									<div className="text-xs text-muted-foreground">Base URL</div>
									<Input
										value={localBaseUrl}
										onChange={(e) => setLocalBaseUrl(e.target.value)}
										placeholder="http://localhost:11434/v1"
									/>
								</div>
								<div className="space-y-1">
									<div className="text-xs text-muted-foreground">Model</div>
									<Input
										value={localModel}
										onChange={(e) => setLocalModel(e.target.value)}
										placeholder="llama3.2"
									/>
								</div>
							</div>

							<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
								<Button
									variant="outline"
									size="sm"
									onClick={onSaveLocalLlm}
									className="sm:w-[96px]"
								>
									Save
								</Button>
								<Button
									variant="secondary"
									size="sm"
									onClick={onTestLocalLlm}
									disabled={isTestingLocal}
									className="sm:w-[96px]"
								>
									{isTestingLocal ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										"Test"
									)}
								</Button>
								<div className="text-xs text-muted-foreground">
									Uses an OpenAI-compatible API base URL.
								</div>
							</div>

							{localTestResult ? (
								<ConnectionBanner
									result={localTestResult}
									successLabel="Local connection successful!"
									failureLabelPrefix="Local connection failed: "
								/>
							) : null}
						</div>

						{!settings.localLlmEnabled ? (
							<div className="text-xs text-muted-foreground">
								Optional: run classification locally before cloud fallback.
							</div>
						) : null}
					</div>
				</Panel>

				<Panel
					title="Local OCR"
					meta="Test OCR using macOS Vision"
					className="max-w-3xl"
					right={
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
							<Button
								variant="outline"
								size="sm"
								onClick={onTestOcr}
								disabled={ocrTest.status === "loading"}
							>
								{ocrTest.status === "loading" ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<EyeIcon className="size-4" />
								)}
								Test OCR
							</Button>
						</div>
					}
				>
					<div className="space-y-3">
						{ocrTest.status === "success" && ocrTest.result ? (
							<div className="space-y-2">
								<div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-500">
									<Check className="h-4 w-4" />
									<span className="text-sm">{ocrTest.message}</span>
								</div>
								<div className="rounded-lg border border-border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-auto">
									{ocrTest.result.text.slice(0, 2000)}
								</div>
							</div>
						) : null}

						{ocrTest.status === "error" ? (
							<div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
								<AlertCircle className="h-4 w-4" />
								<span className="text-sm">{ocrTest.message}</span>
							</div>
						) : null}
					</div>
				</Panel>

				<McpIntegrationPanel />
			</div>
		</TabsContent>
	);
}

function ConnectionBanner({
	result,
	successLabel,
	failureLabelPrefix,
}: {
	result: ConnectionTestResult;
	successLabel: string;
	failureLabelPrefix: string;
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-2 p-3 rounded-lg",
				result.success
					? "bg-green-500/10 text-green-500"
					: "bg-destructive/10 text-destructive",
			)}
		>
			{result.success ? (
				<>
					<Check className="h-4 w-4" />
					<span className="text-sm">{successLabel}</span>
				</>
			) : (
				<>
					<AlertCircle className="h-4 w-4" />
					<span className="text-sm">
						{failureLabelPrefix}
						{result.error || "Unknown error"}
					</span>
				</>
			)}
		</div>
	);
}

function McpIntegrationPanel() {
	const [copied, setCopied] = useState(false);
	const configJson = JSON.stringify(MCP_CONFIG, null, 2);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(configJson);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Panel
			title="MCP Integration"
			meta="Let Claude Desktop or Cursor access your activity data"
			className="max-w-3xl"
			right={
				<a
					href="https://modelcontextprotocol.io/"
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					<ExternalLink className="h-3.5 w-3.5" />
					Docs
				</a>
			}
		>
			<div className="space-y-2">
				<div className="text-xs text-muted-foreground">
					Add to your MCP client config:
				</div>
				<div className="relative">
					<div className="rounded-lg border border-border bg-muted/50 p-3 pr-16 text-xs font-mono whitespace-pre overflow-x-auto">
						{configJson}
					</div>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleCopy}
						className="absolute bottom-2 right-2 h-7 px-2 text-xs"
					>
						{copied ? (
							<Check className="h-3.5 w-3.5" />
						) : (
							<Copy className="h-3.5 w-3.5" />
						)}
					</Button>
				</div>
			</div>
		</Panel>
	);
}
