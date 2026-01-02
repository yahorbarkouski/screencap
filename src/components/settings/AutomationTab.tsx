import { Plus, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { AddMemoryDialog } from "@/components/memory/AddMemoryDialog";
import { MemoryCard } from "@/components/memory/MemoryCard";
import { SettingsTabHeader } from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { Panel } from "@/components/wrapped/Panel";
import { useMemories } from "@/hooks/useMemories";
import {
	behaviorFromAutomationRule,
	isEmptyAutomationRule,
	normalizeAutomationRule,
	type RuleBehavior,
	updatesForBehavior,
} from "@/lib/automationRules";
import type {
	AutomationCategory,
	AutomationRule,
	RecordedApp,
	Settings,
	WebsiteEntry,
} from "@/types";

type RuleType = "apps" | "hosts";

interface RuleRowProps {
	title: string;
	icon?: ReactNode;
	rule: AutomationRule;
	onChange: (updates: Partial<AutomationRule>) => void;
	onDelete: () => void;
}

const CATEGORIES: AutomationCategory[] = [
	"Work",
	"Study",
	"Leisure",
	"Chores",
	"Social",
	"Unknown",
];

function RuleRow({ title, icon, rule, onChange, onDelete }: RuleRowProps) {
	const behavior = behaviorFromAutomationRule(rule);

	return (
		<div className="p-3 rounded-lg bg-muted/50 space-y-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium truncate flex-1 flex items-center gap-2 min-w-0">
					{icon}
					<span className="truncate">{title}</span>
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 shrink-0"
					onClick={onDelete}
				>
					<X className="h-3 w-3" />
				</Button>
			</div>
			<div className="flex flex-wrap items-center gap-4 text-xs">
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted-foreground">Behavior</span>
					<Select
						value={behavior}
						onValueChange={(value) =>
							onChange(updatesForBehavior(value as RuleBehavior))
						}
					>
						<SelectTrigger className="h-7 w-[180px] text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="default">Default</SelectItem>
							<SelectItem value="no_capture">Don&apos;t capture</SelectItem>
							<SelectItem value="capture_only">Capture only (no AI)</SelectItem>
							<SelectItem value="capture_ai">Capture + AI</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{behavior !== "no_capture" && (
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">Category</span>
						<Select
							value={rule.category ?? "__none__"}
							onValueChange={(value) =>
								onChange({
									category:
										value === "__none__"
											? undefined
											: (value as AutomationCategory),
								})
							}
						>
							<SelectTrigger className="h-7 w-[140px] text-xs">
								<SelectValue placeholder="None" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__none__">None</SelectItem>
								{CATEGORIES.map((cat) => (
									<SelectItem key={cat} value={cat}>
										{cat}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</div>
		</div>
	);
}

function AutomationRulesSection({
	settings,
	saveSettings,
}: {
	settings: Settings;
	saveSettings: (settings: Settings) => Promise<void>;
}) {
	const [recordedApps, setRecordedApps] = useState<RecordedApp[]>([]);
	const [recordedHosts, setRecordedHosts] = useState<WebsiteEntry[]>([]);

	useEffect(() => {
		const load = async () => {
			const facets = await window.api.storage.getTimelineFacets({});
			setRecordedApps(facets.apps);
			setRecordedHosts(facets.websites);
		};
		void load();
	}, []);

	const updateRule = useCallback(
		async (
			ruleType: RuleType,
			key: string,
			updates: Partial<AutomationRule>,
		) => {
			const existingRule = settings.automationRules[ruleType][key] ?? {};
			const mergedRule = normalizeAutomationRule({
				...existingRule,
				...updates,
			});
			const nextTypeRules = { ...settings.automationRules[ruleType] };
			if (isEmptyAutomationRule(mergedRule)) {
				delete nextTypeRules[key];
			} else {
				nextTypeRules[key] = mergedRule;
			}
			await saveSettings({
				...settings,
				automationRules: {
					...settings.automationRules,
					[ruleType]: nextTypeRules,
				},
			});
		},
		[settings, saveSettings],
	);

	const deleteRule = useCallback(
		async (ruleType: RuleType, key: string) => {
			const { [key]: _, ...rest } = settings.automationRules[ruleType];
			await saveSettings({
				...settings,
				automationRules: {
					...settings.automationRules,
					[ruleType]: rest,
				},
			});
		},
		[settings, saveSettings],
	);

	const addAppRule = useCallback(
		async (bundleId: string) => {
			if (!bundleId) return;
			await updateRule("apps", bundleId, updatesForBehavior("capture_only"));
		},
		[updateRule],
	);

	const addHostRule = useCallback(
		async (host: string) => {
			if (!host) return;
			await updateRule("hosts", host, updatesForBehavior("capture_only"));
		},
		[updateRule],
	);

	const appEntries = Object.entries(settings.automationRules?.apps ?? {});
	const hostEntries = Object.entries(settings.automationRules?.hosts ?? {});

	const configuredAppIds = useMemo(
		() => new Set(appEntries.map(([k]) => k)),
		[appEntries],
	);
	const configuredHosts = useMemo(
		() => new Set(hostEntries.map(([k]) => k)),
		[hostEntries],
	);

	const availableApps = recordedApps.filter(
		(app) => !configuredAppIds.has(app.bundleId),
	);
	const availableHosts = recordedHosts.filter(
		(site) => !configuredHosts.has(site.host),
	);

	return (
		<Panel
			title="Rules"
			meta="Override capture and AI behavior for specific apps and websites"
		>
			<div className="grid gap-6 md:grid-cols-2">
				<div className="space-y-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="text-sm font-medium">Apps</div>
						{availableApps.length > 0 ? (
							<Select onValueChange={addAppRule}>
								<SelectTrigger className="h-8 w-full sm:w-[220px]">
									<SelectValue placeholder="Add app..." />
								</SelectTrigger>
								<SelectContent>
									{availableApps.map((app) => (
										<SelectItem key={app.bundleId} value={app.bundleId}>
											<span className="flex items-center gap-2 min-w-0">
												{app.appIconPath ? (
													<img
														src={`local-file://${app.appIconPath}`}
														alt=""
														className="h-4 w-4 rounded-sm object-contain"
														loading="lazy"
													/>
												) : null}
												<span className="truncate">
													{app.name ?? app.bundleId}
												</span>
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : null}
					</div>
					{appEntries.length === 0 ? (
						<div className="text-xs text-muted-foreground">
							No app rules configured.
						</div>
					) : (
						<div className="space-y-2">
							{appEntries.map(([key, rule]) => {
								const app = recordedApps.find((a) => a.bundleId === key);
								return (
									<RuleRow
										key={key}
										title={app?.name ?? key}
										icon={
											app?.appIconPath ? (
												<img
													src={`local-file://${app.appIconPath}`}
													alt=""
													className="h-4 w-4 rounded-sm object-contain"
													loading="lazy"
												/>
											) : undefined
										}
										rule={rule}
										onChange={(updates) => updateRule("apps", key, updates)}
										onDelete={() => deleteRule("apps", key)}
									/>
								);
							})}
						</div>
					)}
				</div>

				<div className="space-y-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="text-sm font-medium">Websites</div>
						{availableHosts.length > 0 ? (
							<Select onValueChange={addHostRule}>
								<SelectTrigger className="h-8 w-full sm:w-[220px]">
									<SelectValue placeholder="Add website..." />
								</SelectTrigger>
								<SelectContent>
									{availableHosts.map((site) => (
										<SelectItem key={site.host} value={site.host}>
											{site.host}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : null}
					</div>
					{hostEntries.length === 0 ? (
						<div className="text-xs text-muted-foreground">
							No website rules configured.
						</div>
					) : (
						<div className="space-y-2">
							{hostEntries.map(([key, rule]) => (
								<RuleRow
									key={key}
									title={key}
									rule={rule}
									onChange={(updates) => updateRule("hosts", key, updates)}
									onDelete={() => deleteRule("hosts", key)}
								/>
							))}
						</div>
					)}
				</div>
			</div>
		</Panel>
	);
}

function PreferencesPanel() {
	const { preferences, createMemory, editMemory, deleteMemory } = useMemories();
	const [addDialogOpen, setAddDialogOpen] = useState(false);

	const handleCreate = useCallback(
		async (data: { content: string; description?: string | null }) => {
			await createMemory("preference", data.content, data.description);
			setAddDialogOpen(false);
		},
		[createMemory],
	);

	return (
		<>
			<Panel
				title="Preferences"
				meta="Hints and special instructions injected into the classifier"
				className="max-w-3xl"
				right={
					<Button size="sm" onClick={() => setAddDialogOpen(true)}>
						<Plus className="h-4 w-4 mr-2" />
						Add Preference
					</Button>
				}
			>
				<div className="flex flex-col gap-2 md:grid lg:grid-cols-2 lg:gap-4">
					{preferences.length === 0 ? (
						<div />
					) : (
						preferences.map((memory) => (
							<MemoryCard
								key={memory.id}
								memory={memory}
								onEdit={editMemory}
								onDelete={deleteMemory}
							/>
						))
					)}
				</div>
			</Panel>

			<AddMemoryDialog
				open={addDialogOpen}
				onOpenChange={setAddDialogOpen}
				type="preference"
				onSubmit={handleCreate}
			/>
		</>
	);
}

export function AutomationTab({
	settings,
	saveSettings,
}: {
	settings: Settings;
	saveSettings: (settings: Settings) => Promise<void>;
}) {
	return (
		<TabsContent value="automation" className="p-6 m-0">
			<div className="space-y-6">
				<SettingsTabHeader
					title="Automation"
					description="Skip capture or AI processing for specific apps and websites"
				/>
				<AutomationRulesSection
					settings={settings}
					saveSettings={saveSettings}
				/>
				<PreferencesPanel />
			</div>
		</TabsContent>
	);
}
