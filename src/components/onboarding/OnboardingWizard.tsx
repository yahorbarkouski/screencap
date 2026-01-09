import { motion } from "framer-motion";
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	Check,
	ExternalLink,
	Loader2,
	RefreshCw,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AsciiLogo } from "@/components/onboarding/AsciiLogo";
import { MatrixBorder } from "@/components/onboarding/MatrixBorder";
import { StampStatus } from "@/components/onboarding/StampStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";
import type {
	AppInfo,
	Event,
	EventScreenshot,
	LLMTestResult,
	Settings,
} from "@/types";

const ease = [0.25, 0.1, 0.25, 1] as const;

function FadeIn({
	children,
	delay = 0,
	className = "",
	variant = "step",
}: {
	children: React.ReactNode;
	delay?: number;
	className?: string;
	variant?: "intro" | "step";
}) {
	if (variant === "step") {
		return <div className={className}>{children}</div>;
	}

	const preset =
		variant === "intro"
			? { duration: 0.28, blurPx: 5, yPx: 8 }
			: { duration: 0.08, blurPx: 0, yPx: 2 };

	return (
		<motion.div
			initial={{
				opacity: 0,
				filter: `blur(${preset.blurPx}px)`,
				y: preset.yPx,
			}}
			animate={{
				opacity: 1,
				filter: "blur(0px)",
				y: 0,
			}}
			exit={{
				opacity: 0,
				filter: `blur(${preset.blurPx}px)`,
				y: -preset.yPx,
			}}
			transition={{ duration: preset.duration, ease, delay }}
			className={className}
		>
			{children}
		</motion.div>
	);
}

function PrimaryButton({
	children,
	onClick,
	disabled,
	className = "",
}: {
	children: React.ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<motion.button
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
				"border-zinc-800 bg-black/90 text-zinc-200 hover:bg-zinc-950/60 hover:border-yellow-500/40 hover:text-white",
				"disabled:opacity-50 disabled:pointer-events-none",
				className,
			)}
			whileHover={{
				textShadow:
					"0 0 10px rgba(255, 215, 0, 0.55), 0 0 18px rgba(255, 215, 0, 0.25)",
				boxShadow:
					"0 0 0 1px rgba(255, 215, 0, 0.06), 0 0 18px rgba(255, 215, 0, 0.10)",
			}}
			whileTap={{ scale: 0.99 }}
			transition={{ duration: 0.18 }}
		>
			{children}
		</motion.button>
	);
}

function BackButton({
	onClick,
	className = "",
}: {
	onClick: () => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors",
				"border-zinc-800/50 bg-transparent text-zinc-400 hover:text-white hover:border-zinc-700",
				className,
			)}
		>
			<ArrowLeft className="h-3.5 w-3.5" />
			Back
		</button>
	);
}

function BottomActions({
	left,
	right,
}: {
	left: React.ReactNode;
	right: React.ReactNode;
}) {
	return (
		<div className="fixed bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
			<div className="pointer-events-auto flex items-center justify-center gap-2">
				{left}
				{right}
			</div>
		</div>
	);
}

type OnboardingStep =
	| "welcome"
	| "screen-recording"
	| "accessibility"
	| "automation"
	| "ai-choice"
	| "review";

const STEPS: OnboardingStep[] = [
	"welcome",
	"screen-recording",
	"accessibility",
	"automation",
	"ai-choice",
	"review",
];

interface OnboardingWizardProps {
	onComplete: () => void;
}

function resolveInitialStep(savedStep: string | null): OnboardingStep {
	if (savedStep && STEPS.includes(savedStep as OnboardingStep)) {
		return savedStep as OnboardingStep;
	}
	return "welcome";
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
	const { settings, saveSettings } = useSettings();
	const [step, setStep] = useState<OnboardingStep>(() =>
		resolveInitialStep(settings.onboarding.lastStep),
	);
	const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
	const status = useOnboardingStatus(1500);
	const [pendingCompletionSettings, setPendingCompletionSettings] =
		useState<Settings | null>(null);
	const [sampleEventId, setSampleEventId] = useState<string | null>(null);
	const [isCapturingSample, setIsCapturingSample] = useState(false);
	const [autoCaptureAttempted, setAutoCaptureAttempted] = useState(false);

	useEffect(() => {
		window.api?.app.getInfo().then(setAppInfo);
	}, []);

	const persistStep = useCallback(
		(nextStep: OnboardingStep) => {
			const nextSettings: Settings = {
				...settings,
				onboarding: {
					...settings.onboarding,
					lastStep: nextStep,
				},
			};
			void saveSettings(nextSettings);
		},
		[settings, saveSettings],
	);

	const currentIndex = STEPS.indexOf(step);

	const goNext = useCallback(() => {
		const nextIndex = currentIndex + 1;
		if (nextIndex < STEPS.length) {
			const nextStep = STEPS[nextIndex];
			setStep(nextStep);
			persistStep(nextStep);
		}
	}, [currentIndex, persistStep]);

	const goBack = useCallback(() => {
		const prevIndex = currentIndex - 1;
		if (prevIndex >= 0) {
			const prevStep = STEPS[prevIndex];
			setStep(prevStep);
			persistStep(prevStep);
		}
	}, [currentIndex, persistStep]);

	const handleComplete = useCallback(
		async (baseSettings: Settings) => {
			const nextSettings: Settings = {
				...baseSettings,
				onboarding: {
					version: baseSettings.onboarding.version,
					completedAt: Date.now(),
					lastStep: null,
				},
			};
			await saveSettings(nextSettings);
			if (status.canCapture) {
				await window.api?.scheduler.start(nextSettings.captureInterval);
			}
			onComplete();
		},
		[saveSettings, status.canCapture, onComplete],
	);

	const captureSample = useCallback(async (): Promise<string | null> => {
		if (isCapturingSample) return sampleEventId;
		setIsCapturingSample(true);
		try {
			const result = await window.api.capture.trigger({
				includeSenderWindow: true,
			});
			const nextEventId = result.eventId ?? null;
			setSampleEventId(nextEventId);
			return nextEventId;
		} catch {
			return null;
		} finally {
			setIsCapturingSample(false);
		}
	}, [isCapturingSample, sampleEventId]);

	useEffect(() => {
		if (step !== "screen-recording") return;
		if (autoCaptureAttempted) return;
		if (status.screenCaptureStatus !== "granted") return;
		if (sampleEventId) return;
		setAutoCaptureAttempted(true);
		void captureSample();
	}, [
		autoCaptureAttempted,
		captureSample,
		sampleEventId,
		status.screenCaptureStatus,
		step,
	]);

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-background">
			<div className="h-10 drag-region shrink-0" />
			<div className="flex-1 flex flex-col overflow-hidden">
				<ProgressBar
					current={currentIndex}
					className="h-0 overflow-hidden px-0 pt-0 pb-0 opacity-0 pointer-events-none"
				/>
				<ScrollArea className="flex-1">
					<div className="relative max-w-2xl mx-auto px-6 py-8 min-h-full flex flex-col justify-center">
						{step === "welcome" && <WelcomeStep onNext={goNext} />}
						{step === "screen-recording" && (
							<ScreenRecordingStep
								status={status.screenCaptureStatus}
								isPackaged={appInfo?.isPackaged ?? false}
								isCapturingSample={isCapturingSample}
								onNext={goNext}
								onRefresh={status.refresh}
								onBack={goBack}
							/>
						)}
						{step === "accessibility" && (
							<AccessibilityStep
								status={status.accessibilityStatus}
								onNext={goNext}
								onSkip={goNext}
								onRefresh={status.refresh}
								onBack={goBack}
							/>
						)}
						{step === "automation" && (
							<AutomationStep
								automationStatus={status.automationStatus}
								onNext={goNext}
								onRefresh={status.refresh}
								onBack={goBack}
							/>
						)}
						{step === "ai-choice" && (
							<AIChoiceStep
								settings={settings}
								saveSettings={saveSettings}
								onBack={goBack}
								onNext={async (next) => {
									setPendingCompletionSettings(next);
									goNext();
								}}
							/>
						)}
						{step === "review" && (
							<ReviewStep
								eventId={sampleEventId}
								isCapturingSample={isCapturingSample}
								onCaptureSample={captureSample}
								onBack={goBack}
								onFinish={async () => {
									if (sampleEventId) {
										await window.api.storage.finalizeOnboardingEvent(
											sampleEventId,
										);
									}
									await handleComplete(pendingCompletionSettings ?? settings);
								}}
							/>
						)}
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}

function ProgressBar({
	current,
	className,
}: {
	current: number;
	className?: string;
}) {
	return (
		<div className={cn(className)}>
			<div className="max-w-2xl mx-auto">
				<div className="flex gap-1">
					{STEPS.map((stepName, idx) => (
						<div
							key={stepName}
							className={cn(
								"h-1 flex-1 rounded-full transition-colors",
								idx <= current ? "bg-primary" : "bg-muted",
							)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
	const [ctaActive, setCtaActive] = useState(false);

	return (
		<motion.div
			className="space-y-6 pb-24"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.18, ease }}
		>
			<FadeIn delay={0} variant="intro">
				<AsciiLogo />
			</FadeIn>

			<FadeIn delay={0.05} variant="intro">
				<div className="text-center space-y-3 -mt-16">
					<p className="text-sm text-muted-foreground max-w-md mx-auto">
						What did I do today? Yesterday? How long do I actualy work? Am I
						addicted to bullet chess? Screencap to understand your time
					</p>
				</div>
			</FadeIn>

			<FadeIn delay={0.22} variant="intro">
				<div className="flex justify-center mt-12">
					<MatrixBorder active={ctaActive} className="w-[280px]">
						<button
							type="button"
							onClick={onNext}
							onMouseEnter={() => setCtaActive(true)}
							onMouseLeave={() => setCtaActive(false)}
							onFocus={() => setCtaActive(true)}
							onBlur={() => setCtaActive(false)}
							className={cn(
								"relative z-10 w-full flex items-center justify-center px-6 py-3.5",
								"bg-transparent text-zinc-400 transition-colors hover:text-zinc-100",
							)}
						>
							<span className="text-sm font-medium">Get started</span>
						</button>
					</MatrixBorder>
				</div>
			</FadeIn>
		</motion.div>
	);
}

function ScreenRecordingStep({
	status,
	isPackaged,
	isCapturingSample,
	onNext,
	onRefresh,
	onBack,
}: {
	status: "granted" | "denied" | "not-determined";
	isPackaged: boolean;
	isCapturingSample: boolean;
	onNext: () => void;
	onRefresh: () => void;
	onBack: () => void;
}) {
	const [isChecking, setIsChecking] = useState(false);

	const handleOpenSettings = () => {
		window.api?.permissions.openSettings();
	};

	const handleCheckAgain = async () => {
		setIsChecking(true);
		await onRefresh();
		setTimeout(() => setIsChecking(false), 500);
	};

	const isGranted = status === "granted";
	const appName = isPackaged ? "Screencap" : "Electron";

	return (
		<div className="space-y-6 pb-24">
			<FadeIn delay={0}>
				<div className="text-center space-y-3">
					<div className="flex items-center justify-center gap-2">
						<h1 className="text-2xl font-bold">Screen Recording</h1>
						<span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-500 uppercase tracking-wide font-medium">
							required
						</span>
					</div>
					<p className="text-sm text-muted-foreground max-w-sm mx-auto">
						Time analytics is boring without pictures. Screencap captures
						screenshots to give you a visual timeline of your day with optional
						ML classification
					</p>
				</div>
			</FadeIn>

			<FadeIn delay={0.02}>
				<PermissionStatusBadge status={status} />
			</FadeIn>

			<FadeIn delay={0.04}>
				<div className="space-y-2 text-center max-w-sm mx-auto">
					<p className="text-xs text-muted-foreground">
						Everything stays on your Mac. Screenshots are stored locally and
						automatically cleaned up based on your retention settings.
					</p>
					<p className="text-xs text-muted-foreground">
						Capture pauses when you're idle and respects your app exclusions.
						Nothing is shared unless you explicitly enable AI.
					</p>
				</div>
			</FadeIn>

			{!isGranted && (
				<FadeIn delay={0.06}>
					<div className="flex justify-center gap-3 mb-4">
						<PrimaryButton onClick={handleOpenSettings}>
							<ExternalLink className="h-4 w-4" />
							Open System Settings
						</PrimaryButton>
						<Button
							variant="outline"
							size="sm"
							onClick={handleCheckAgain}
							disabled={isChecking}
						>
							{isChecking ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<RefreshCw className="h-3.5 w-3.5" />
							)}
						</Button>
					</div>

					<div className="bg-muted/30 rounded-lg p-3 max-w-sm mx-auto">
						<p className="text-[11px] text-muted-foreground text-center">
							Find{" "}
							<span className="text-foreground font-medium">{appName}</span> in
							Privacy & Security → Screen Recording. Toggle off then on if
							already listed.
						</p>
					</div>
				</FadeIn>
			)}

			<BottomActions
				left={<BackButton onClick={onBack} />}
				right={
					<PrimaryButton
						onClick={onNext}
						className="h-9 px-4"
						disabled={!isGranted || isCapturingSample}
					>
						{isCapturingSample ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" />
								Capturing
							</>
						) : (
							"Continue"
						)}
						<ArrowRight className="h-4 w-4" />
					</PrimaryButton>
				}
			/>
		</div>
	);
}

function AccessibilityStep({
	status,
	onNext,
	onSkip,
	onRefresh,
	onBack,
}: {
	status: "granted" | "denied" | "not-determined";
	onNext: () => void;
	onSkip: () => void;
	onRefresh: () => void;
	onBack: () => void;
}) {
	const [isRequesting, setIsRequesting] = useState(false);

	const handleRequest = async () => {
		setIsRequesting(true);
		await window.api?.permissions.requestAccessibility();
		setTimeout(() => {
			onRefresh();
			setIsRequesting(false);
		}, 1000);
	};

	const handleOpenSettings = () => {
		window.api?.permissions.openAccessibilitySettings();
	};

	const isGranted = status === "granted";

	return (
		<div className="space-y-6 pb-24">
			<FadeIn delay={0}>
				<div className="text-center space-y-3">
					<div className="flex items-center justify-center gap-2">
						<h1 className="text-2xl font-bold">Know What App You're In</h1>
					</div>
					<p className="text-sm text-muted-foreground max-w-lg mx-auto">
						Accessibility allows Screencap to understand a big part of the
						screenshot event without analyzing it, makes your timeline
						searchable and cleaner
					</p>
				</div>
			</FadeIn>
			<FadeIn delay={0.04}>
				<div className="max-w-lg mx-auto space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<ContextExampleCard
							variant="without"
							appName="Unknown"
							detail="Screenshot captured"
						/>
						<ContextExampleCard
							variant="with"
							appName="Google Chrome"
							detail="GitHub — Issue #331"
						/>
					</div>
					<p className="text-xs text-muted-foreground text-center">
						Toggleable in settings later
					</p>
				</div>
			</FadeIn>

			{!isGranted && (
				<FadeIn delay={0.08}>
					<div className="flex justify-center gap-3 mb-4">
						<PrimaryButton onClick={handleRequest} disabled={isRequesting}>
							{isRequesting ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								"Grant Permission"
							)}
						</PrimaryButton>
						<Button variant="outline" size="sm" onClick={handleOpenSettings}>
							<ExternalLink className="h-3.5 w-3.5" />
							Settings
						</Button>
					</div>
				</FadeIn>
			)}

			<FadeIn delay={0.02}>
				<PermissionStatusBadge status={status} />
			</FadeIn>

			<BottomActions
				left={<BackButton onClick={onBack} />}
				right={
					<PrimaryButton
						onClick={isGranted ? onNext : onSkip}
						className="h-9 px-4"
					>
						{isGranted ? "Continue" : "Skip for now"}
						<ArrowRight className="h-4 w-4" />
					</PrimaryButton>
				}
			/>
		</div>
	);
}

function AutomationStep({
	automationStatus,
	onNext,
	onRefresh,
	onBack,
}: {
	automationStatus: {
		systemEvents: "granted" | "denied" | "not-determined";
		browsers: "granted" | "denied" | "not-determined";
		apps: "granted" | "denied" | "not-determined";
	};
	onNext: () => void;
	onRefresh: () => void;
	onBack: () => void;
}) {
	const [isTesting, setIsTesting] = useState(false);

	const handleTest = async () => {
		setIsTesting(true);
		await window.api?.context.test();
		setTimeout(() => {
			onRefresh();
			setIsTesting(false);
		}, 1000);
	};

	const handleOpenSettings = () => {
		window.api?.permissions.openAutomationSettings();
	};

	return (
		<div className="space-y-6 pb-24">
			<FadeIn delay={0}>
				<div className="text-center space-y-3">
					<div className="flex items-center justify-center gap-2">
						<h1 className="text-2xl font-bold">Automation permissions</h1>
					</div>
					<p className="text-sm text-muted-foreground max-w-md mx-auto">
						These permissions let Screencap ask other apps what you're doing —
						like which URL is open or what song is playing
					</p>
				</div>
			</FadeIn>

			<FadeIn delay={0.02} className="space-y-3 max-w-lg mx-auto">
				<AutomationItemEnhanced
					label="System Events"
					status={automationStatus.systemEvents}
					description="Identifies which window is focused when you have multiple apps open"
					example={{
						without: "Finder | Safari | Cursor",
						with: "Cursor - Screencap workspace",
					}}
				/>
				<AutomationItemEnhanced
					label="Browsers"
					status={automationStatus.browsers}
					description="Reads the URL from Safari, Chrome, Arc, and other browsers"
					example={{
						without: "Safari",
						with: "GitHub — Issue #1234",
					}}
				/>
				<AutomationItemEnhanced
					label="Media Apps"
					status={automationStatus.apps}
					description="Captures what's playing in Spotify, Apple Music, or other media apps"
					example={{
						without: "Spotify",
						with: "Spotify — Daft Punk · Get Lucky",
					}}
				/>
			</FadeIn>

			<FadeIn delay={0.06}>
				<div className="flex justify-center gap-3 mb-4">
					<PrimaryButton onClick={handleTest} disabled={isTesting}>
						{isTesting ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							"Test changes"
						)}
					</PrimaryButton>
					<Button variant="outline" size="sm" onClick={handleOpenSettings}>
						<ExternalLink className="h-3.5 w-3.5" />
						Settings
					</Button>
				</div>
			</FadeIn>

			<BottomActions
				left={<BackButton onClick={onBack} />}
				right={
					<PrimaryButton onClick={onNext} className="h-9 px-4">
						Continue
						<ArrowRight className="h-4 w-4" />
					</PrimaryButton>
				}
			/>
		</div>
	);
}

type AiModeChoice = "local" | "cloud" | "disabled";

function AIChoiceStep({
	settings,
	saveSettings,
	onBack,
	onNext,
}: {
	settings: Settings;
	saveSettings: (settings: Settings) => Promise<void>;
	onBack: () => void;
	onNext: (settings: Settings) => Promise<void>;
}) {
	const deriveMode = (): AiModeChoice => {
		if (!settings.llmEnabled) return "disabled";
		if (settings.localLlmEnabled) return "local";
		return "cloud";
	};

	const [mode, setMode] = useState<AiModeChoice>(deriveMode);
	const [allowVisionUploads, setAllowVisionUploads] = useState(
		settings.allowVisionUploads,
	);
	const [apiKey, setApiKey] = useState(settings.apiKey ?? "");
	const [localBaseUrl, setLocalBaseUrl] = useState(settings.localLlmBaseUrl);
	const [localModel, setLocalModel] = useState(settings.localLlmModel);

	const [cloudTestResult, setCloudTestResult] = useState<LLMTestResult | null>(
		null,
	);
	const [localTestResult, setLocalTestResult] = useState<LLMTestResult | null>(
		null,
	);
	const [isTestingCloud, setIsTestingCloud] = useState(false);
	const [isTestingLocal, setIsTestingLocal] = useState(false);
	const [isContinuing, setIsContinuing] = useState(false);

	useEffect(() => {
		const nextMode: AiModeChoice = !settings.llmEnabled
			? "disabled"
			: settings.localLlmEnabled
				? "local"
				: "cloud";
		setMode(nextMode);
		setAllowVisionUploads(settings.allowVisionUploads);
		setApiKey(settings.apiKey ?? "");
		setLocalBaseUrl(settings.localLlmBaseUrl);
		setLocalModel(settings.localLlmModel);
	}, [
		settings.allowVisionUploads,
		settings.apiKey,
		settings.llmEnabled,
		settings.localLlmBaseUrl,
		settings.localLlmEnabled,
		settings.localLlmModel,
	]);

	const localConfigured = Boolean(localBaseUrl.trim() && localModel.trim());
	const cloudConfigured = Boolean(apiKey.trim());

	const draftSettings = useCallback((): Settings => {
		if (mode === "disabled") {
			return {
				...settings,
				llmEnabled: false,
				localLlmEnabled: false,
				allowVisionUploads: false,
				apiKey: null,
			};
		}

		if (mode === "local") {
			return {
				...settings,
				llmEnabled: true,
				localLlmEnabled: true,
				localLlmBaseUrl: localBaseUrl,
				localLlmModel: localModel,
				allowVisionUploads: false,
				apiKey: null,
			};
		}

		return {
			...settings,
			llmEnabled: true,
			localLlmEnabled: false,
			apiKey: apiKey.trim() || null,
			allowVisionUploads: apiKey.trim() ? allowVisionUploads : false,
		};
	}, [mode, apiKey, allowVisionUploads, localBaseUrl, localModel, settings]);

	const persistDraft = useCallback(async () => {
		const next = draftSettings();
		await saveSettings(next);
		return next;
	}, [draftSettings, saveSettings]);

	return (
		<div className="space-y-6 pb-24">
			<FadeIn delay={0}>
				<div className="text-center space-y-3">
					<div className="flex items-center justify-center gap-2">
						<h1 className="text-2xl font-bold">Classification</h1>
					</div>
					<p className="text-sm text-muted-foreground max-w-md mx-auto">
						Choose how capture events are classified. Cloud is recommended
						option for best accuracy, while local suits privacy-first users
					</p>
				</div>
			</FadeIn>

			<FadeIn delay={0.02}>
				<div className="grid grid-cols-2 gap-6 max-w-2xl mx-auto">
					<div className="space-y-3">
						<button
							type="button"
							onClick={() => setMode("cloud")}
							className={cn(
								"w-full p-4 rounded-lg border text-left transition-colors",
								mode === "cloud"
									? "border-yellow-500/40 bg-yellow-500/5"
									: "border-zinc-800/50 bg-black/30 hover:border-zinc-700",
							)}
						>
							<div className="flex items-center gap-3">
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<p className="font-medium">Cloud LLM</p>
										<span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-500 uppercase tracking-wide font-medium">
											default
										</span>
									</div>
									<p className="text-xs text-muted-foreground mt-0.5">
										Best accuracy
									</p>
								</div>
								{mode === "cloud" && (
									<Check className="h-5 w-5 text-primary shrink-0" />
								)}
							</div>
						</button>

						<button
							type="button"
							onClick={() => setMode("local")}
							className={cn(
								"w-full p-4 rounded-lg border text-left transition-colors",
								mode === "local"
									? "border-yellow-500/40 bg-yellow-500/5"
									: "border-zinc-800/50 bg-black/30 hover:border-zinc-700",
							)}
						>
							<div className="flex items-center gap-3">
								<div className="flex-1">
									<p className="font-medium">Local LLM</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										Fully offline with Ollama or LM Studio
									</p>
								</div>
								{mode === "local" && (
									<Check className="h-5 w-5 text-primary shrink-0" />
								)}
							</div>
						</button>

						<button
							type="button"
							onClick={() => setMode("disabled")}
							className={cn(
								"w-full p-4 rounded-lg border text-left transition-colors",
								mode === "disabled"
									? "border-yellow-500/40 bg-yellow-500/5"
									: "border-zinc-800/50 bg-black/30 hover:border-zinc-700",
							)}
						>
							<div className="flex items-center gap-3">
								<div className="flex-1">
									<p className="font-medium">Disable all</p>
									<p className="text-xs text-muted-foreground mt-0.5">
										No AI classification
									</p>
								</div>
								{mode === "disabled" && (
									<Check className="h-5 w-5 text-primary shrink-0" />
								)}
							</div>
						</button>
					</div>

					<div className="min-h-[200px]">
						{mode === "cloud" && (
							<div className="space-y-3 p-4 rounded-lg bg-muted/50 h-full">
								<div className="flex items-center justify-between gap-3">
									<p className="text-sm font-medium">OpenRouter</p>
									<a
										href="https://openrouter.ai/keys"
										onClick={(e) => {
											e.preventDefault();
											window.api?.app.openExternal(
												"https://openrouter.ai/keys",
											);
										}}
										className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
									>
										<ExternalLink className="h-3.5 w-3.5" />
										Get key
									</a>
								</div>

								<div className="space-y-2">
									<label className="text-xs text-muted-foreground">
										API key (OpenRouter or OpenAI compatible)
									</label>
									<Input
										type="password"
										value={apiKey}
										onChange={(e) => setApiKey(e.target.value)}
										placeholder="sk-..."
									/>
								</div>

								<Button
									onClick={async () => {
										setIsTestingCloud(true);
										setCloudTestResult(null);
										try {
											await persistDraft();
											const result = await window.api?.llm.testConnection();
											setCloudTestResult(
												result ?? { success: false, error: "No response" },
											);
										} catch (error) {
											setCloudTestResult({
												success: false,
												error: String(error),
											});
										} finally {
											setIsTestingCloud(false);
										}
									}}
									disabled={!cloudConfigured || isTestingCloud}
									className="w-full"
								>
									{isTestingCloud ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										"Test & Save"
									)}
								</Button>

								{cloudTestResult && (
									<div
										className={cn(
											"flex items-center gap-2 p-2 rounded-lg text-sm",
											cloudTestResult.success
												? "bg-green-500/10 text-green-600 dark:text-green-400"
												: "bg-destructive/10 text-destructive",
										)}
									>
										{cloudTestResult.success ? (
											<>
												<Check className="h-4 w-4" />
												Connected
											</>
										) : (
											<>
												<AlertCircle className="h-4 w-4" />
												{cloudTestResult.error || "Failed"}
											</>
										)}
									</div>
								)}
							</div>
						)}

						{mode === "local" && (
							<div className="space-y-3 p-4 rounded-lg bg-muted/50 h-full">
								<p className="text-sm font-medium">Ollama / LM Studio</p>

								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">
										Base URL
									</label>
									<Input
										value={localBaseUrl}
										onChange={(e) => setLocalBaseUrl(e.target.value)}
										placeholder="http://localhost:11434/v1"
									/>
								</div>
								<div className="space-y-1">
									<label className="text-xs text-muted-foreground">Model</label>
									<Input
										value={localModel}
										onChange={(e) => setLocalModel(e.target.value)}
										placeholder="llama3.2"
									/>
								</div>
								<Button
									onClick={async () => {
										setIsTestingLocal(true);
										setLocalTestResult(null);
										try {
											await persistDraft();
											const result =
												await window.api?.llm.testLocalConnection();
											setLocalTestResult(
												result ?? { success: false, error: "No response" },
											);
										} catch (error) {
											setLocalTestResult({
												success: false,
												error: String(error),
											});
										} finally {
											setIsTestingLocal(false);
										}
									}}
									disabled={!localConfigured || isTestingLocal}
									className="w-full"
								>
									{isTestingLocal ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										"Test & Save"
									)}
								</Button>

								{!localConfigured && (
									<div className="text-xs text-amber-600/80 dark:text-amber-400/80">
										Set Base URL and Model to enable.
									</div>
								)}

								{localTestResult && (
									<div
										className={cn(
											"flex items-center gap-2 p-2 rounded-lg text-sm",
											localTestResult.success
												? "bg-green-500/10 text-green-600 dark:text-green-400"
												: "bg-destructive/10 text-destructive",
										)}
									>
										{localTestResult.success ? (
											<>
												<Check className="h-4 w-4" />
												Connected
											</>
										) : (
											<>
												<AlertCircle className="h-4 w-4" />
												{localTestResult.error || "Failed"}
											</>
										)}
									</div>
								)}
							</div>
						)}

						{mode === "disabled" && (
							<div className="flex items-center justify-center h-full p-4 rounded-lg border border-dashed border-zinc-800/50">
								<p className="text-sm text-muted-foreground text-center">
									Screenshots will be captured but not classified by AI
								</p>
							</div>
						)}
					</div>
				</div>
			</FadeIn>

			<FadeIn delay={0.08}>
				<div className="space-y-3 max-w-2xl mx-auto mt-16">
					<div className="text-center space-y-1">
						<p className="text-sm font-medium">Privacy controls</p>
						<p className="text-xs text-muted-foreground">
							You can fine-tune capture anytime in Settings
						</p>
					</div>
					<div className="grid grid-cols-3 gap-3">
						<PrivacyItem
							title="Skip capture"
							description="Block screenshots for specific apps or domains"
						/>
						<PrivacyItem
							title="Skip AI"
							description="Capture locally but never send to AI"
						/>
						<PrivacyItem
							title="Idle detection"
							description="Auto-pause after 5+ minutes of inactivity"
						/>
					</div>
				</div>
			</FadeIn>

			<BottomActions
				left={<BackButton onClick={onBack} />}
				right={
					<PrimaryButton
						onClick={async () => {
							setIsContinuing(true);
							try {
								await onNext(draftSettings());
							} finally {
								setIsContinuing(false);
							}
						}}
						className="h-9 px-4"
						disabled={isContinuing}
					>
						{isContinuing ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<>
								Continue
								<ArrowRight className="h-4 w-4" />
							</>
						)}
					</PrimaryButton>
				}
			/>
		</div>
	);
}

const ONBOARDING_DEMO_META = {
	appName: "Screencap",
	category: "Chores",
	subcategories: "Setup",
	caption: "Completing onboarding — your journey with Screencap begins",
	windowTitle: "Welcome to Screencap",
} as const;

function ReviewStep({
	eventId,
	isCapturingSample,
	onCaptureSample,
	onBack,
	onFinish,
}: {
	eventId: string | null;
	isCapturingSample: boolean;
	onCaptureSample: () => Promise<string | null>;
	onBack: () => void;
	onFinish: () => Promise<void>;
}) {
	const [event, setEvent] = useState<Event | null>(null);
	const [screenshots, setScreenshots] = useState<EventScreenshot[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isFinishing, setIsFinishing] = useState(false);
	const [retryAttempted, setRetryAttempted] = useState(false);

	const refresh = useCallback(async () => {
		if (!eventId) {
			setEvent(null);
			setScreenshots([]);
			return;
		}
		setIsLoading(true);
		try {
			const [nextEvent, nextShots] = await Promise.all([
				window.api.storage.getEvent(eventId),
				window.api.storage.getEventScreenshots(eventId),
			]);
			setEvent(nextEvent);
			setScreenshots(nextShots);
		} finally {
			setIsLoading(false);
		}
	}, [eventId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (retryAttempted) return;
		if (isCapturingSample) return;
		if (eventId) return;
		setRetryAttempted(true);
		void onCaptureSample();
	}, [retryAttempted, isCapturingSample, eventId, onCaptureSample]);

	const primaryScreenshot =
		screenshots.find((s) => s.isPrimary) ?? screenshots[0] ?? null;
	const previewPath =
		primaryScreenshot?.originalPath ??
		event?.originalPath ??
		event?.thumbnailPath ??
		null;

	return (
		<div className="space-y-6 pb-24">
			<FadeIn delay={0}>
				<div className="text-center space-y-3">
					<h1 className="text-2xl font-bold">This is how Screencap sees</h1>
					<p className="text-sm text-muted-foreground max-w-md mx-auto">
						We just captured this moment. Every few minutes, this is exactly
						what happens — automatically, in the background.
					</p>
				</div>
			</FadeIn>

			<FadeIn delay={0.02}>
				<div className="rounded-xl border border-zinc-800/50 bg-black/20 overflow-hidden">
					<div className="aspect-video bg-muted/30 flex items-center justify-center">
						{previewPath ? (
							<img
								src={`local-file://${previewPath}`}
								alt=""
								className="w-full h-full object-cover"
								loading="lazy"
							/>
						) : (
							<div className="text-sm text-muted-foreground flex flex-col items-center gap-3">
								{isCapturingSample || isLoading ? (
									<div className="flex items-center gap-2">
										<Loader2 className="h-4 w-4 animate-spin" />
										Capturing this moment…
									</div>
								) : (
									<>
										<span>Capture failed — try again?</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												setRetryAttempted(false);
											}}
										>
											<RefreshCw className="h-3.5 w-3.5 mr-1.5" />
											Retry
										</Button>
									</>
								)}
							</div>
						)}
					</div>
					<div className="p-4 space-y-2">
						<div className="flex items-center justify-between gap-2">
							<div className="text-sm font-medium">
								{ONBOARDING_DEMO_META.appName}
							</div>
							<div className="text-xs text-muted-foreground flex items-center gap-2">
								{(isCapturingSample || isLoading) && (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								)}
								{isCapturingSample || isLoading ? "capturing" : "completed"}
							</div>
						</div>
						<div className="text-sm text-muted-foreground">
							{ONBOARDING_DEMO_META.caption}
						</div>
						<div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
							<div className="truncate">
								<span className="text-foreground/80">Category:</span>{" "}
								{ONBOARDING_DEMO_META.category}
							</div>
							<div className="truncate">
								<span className="text-foreground/80">Subcategory:</span>{" "}
								{ONBOARDING_DEMO_META.subcategories}
							</div>
							<div className="truncate col-span-2">
								<span className="text-foreground/80">Window:</span>{" "}
								{ONBOARDING_DEMO_META.windowTitle}
							</div>
						</div>
					</div>
				</div>
			</FadeIn>

			<BottomActions
				left={<BackButton onClick={onBack} />}
				right={
					<PrimaryButton
						onClick={async () => {
							setIsFinishing(true);
							try {
								await onFinish();
							} finally {
								setIsFinishing(false);
							}
						}}
						className="h-9 px-4"
						disabled={isFinishing || isCapturingSample || isLoading}
					>
						{isFinishing ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<>
								Start
								<ArrowRight className="h-4 w-4" />
							</>
						)}
					</PrimaryButton>
				}
			/>
		</div>
	);
}

function PrivacyItem({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="p-3 rounded-lg bg-muted/50">
			<p className="text-sm font-medium">{title}</p>
			<p className="text-xs text-muted-foreground mt-0.5">{description}</p>
		</div>
	);
}

function PermissionStatusBadge({
	status,
}: {
	status: "granted" | "denied" | "not-determined";
}) {
	if (status === "granted") {
		return <StampStatus />;
	}

	const config = {
		denied: {
			bg: "bg-red-500/10",
			text: "text-red-600 dark:text-red-400",
			icon: <X className="h-3 w-3" />,
			label: "Denied",
		},
		"not-determined": {
			bg: "bg-amber-500/10",
			text: "text-amber-600 dark:text-amber-400",
			icon: <AlertCircle className="h-3 w-3" />,
			label: "Not granted",
		},
	};

	const { bg, text, icon, label } = config[status];

	return (
		<div className="flex justify-center">
			<div
				className={cn(
					"inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
					bg,
					text,
				)}
			>
				{icon}
				{label}
			</div>
		</div>
	);
}

function ContextExampleCard({
	variant,
	appName,
	detail,
}: {
	variant: "with" | "without";
	appName: string;
	detail: string;
}) {
	const isWithPermission = variant === "with";

	return (
		<div
			className={cn(
				"rounded-lg border p-3 space-y-2",
				isWithPermission
					? "border-green-500/30 bg-green-500/5"
					: "border-zinc-700/50 bg-zinc-900/30",
			)}
		>
			<div className="flex items-center gap-2">
				{isWithPermission ? (
					<Check className="h-3.5 w-3.5 text-green-500" />
				) : (
					<X className="h-3.5 w-3.5 text-zinc-500" />
				)}
				<span
					className={cn(
						"text-[10px] uppercase tracking-wide font-medium",
						isWithPermission ? "text-green-500" : "text-zinc-500",
					)}
				>
					{isWithPermission ? "With permission" : "Without"}
				</span>
			</div>
			<div>
				<p
					className={cn(
						"text-sm font-medium",
						isWithPermission ? "text-zinc-200" : "text-zinc-400",
					)}
				>
					{appName}
				</p>
				<p
					className={cn(
						"text-xs truncate",
						isWithPermission ? "text-zinc-400" : "text-zinc-600",
					)}
				>
					{detail}
				</p>
			</div>
		</div>
	);
}

function AutomationItemEnhanced({
	label,
	description,
	status,
	example,
}: {
	label: string;
	description: string;
	status: "granted" | "denied" | "not-determined";
	example: { without: string; with: string };
}) {
	const statusConfig = {
		granted: {
			bg: "bg-green-500/10",
			border: "border-green-500/20",
			badge: "bg-green-500/20 text-green-500",
			label: "Granted",
		},
		denied: {
			bg: "bg-red-500/5",
			border: "border-red-500/20",
			badge: "bg-red-500/20 text-red-500",
			label: "Denied",
		},
		"not-determined": {
			bg: "bg-zinc-900/50",
			border: "border-zinc-800/50",
			badge: "bg-zinc-700/50 text-zinc-400",
			label: "Pending",
		},
	};

	const config = statusConfig[status];

	return (
		<div
			className={cn(
				"rounded-xl border p-4 space-y-3",
				config.bg,
				config.border,
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<p className="text-sm font-medium text-zinc-200">{label}</p>
						<span
							className={cn(
								"text-[10px] px-1.5 py-0.5 rounded-md font-medium",
								config.badge,
							)}
						>
							{config.label}
						</span>
					</div>
					<p className="text-xs text-zinc-400 mt-1">{description}</p>
				</div>
			</div>
			<div className="flex items-center gap-2 text-[11px]">
				<span className="text-zinc-500 truncate">{example.without}</span>
				<ArrowRight className="h-3 w-3 text-zinc-500 shrink-0" />
				<span className="text-zinc-300 truncate font-medium">
					{example.with}
				</span>
			</div>
		</div>
	);
}
