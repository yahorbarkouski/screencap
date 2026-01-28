import {
	AlertCircle,
	AppWindow,
	BookOpen,
	Briefcase,
	Gamepad2,
	Globe,
	HelpCircle,
	Home,
	Search,
	SlidersHorizontal,
	Tag,
	TrendingUp,
	Users,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateRangeSelect } from "@/components/ui/date-range-select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getTodayFilters, useAppStore } from "@/stores/app";
import type { RecordedApp, WebsiteEntry } from "@/types";

const CATEGORIES = ["Study", "Work", "Leisure", "Chores", "Social", "Unknown"];

const CATEGORY_ICON = {
	Study: BookOpen,
	Work: Briefcase,
	Leisure: Gamepad2,
	Chores: Home,
	Social: Users,
	Unknown: HelpCircle,
} as const;

const CATEGORY_OPTIONS = CATEGORIES.map((cat) => {
	const Icon = CATEGORY_ICON[cat as keyof typeof CATEGORY_ICON];
	return { value: cat, label: cat, icon: <Icon className="h-4 w-4" /> };
});

function areStringArraysEqual(
	a: readonly string[],
	b: readonly string[],
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function areWebsitesEqual(
	a: readonly WebsiteEntry[],
	b: readonly WebsiteEntry[],
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i].host !== b[i].host || a[i].faviconPath !== b[i].faviconPath)
			return false;
	}
	return true;
}

function areAppsEqual(
	a: readonly RecordedApp[],
	b: readonly RecordedApp[],
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (
			a[i].bundleId !== b[i].bundleId ||
			a[i].name !== b[i].name ||
			a[i].appIconPath !== b[i].appIconPath
		)
			return false;
	}
	return true;
}

function appLabel(app: RecordedApp): string {
	return app.name ?? app.bundleId;
}

interface ActiveFilter {
	key: string;
	label: string;
	icon?: ReactNode;
	onRemove: () => void;
}

export const TimelineFilters = memo(function TimelineFilters() {
	const filters = useAppStore((s) => s.filters);
	const setFilters = useAppStore((s) => s.setFilters);
	const clearFilters = useAppStore((s) => s.clearFilters);
	const [search, setSearch] = useState(filters.search || "");
	const [projects, setProjects] = useState<string[]>([]);
	const [apps, setApps] = useState<RecordedApp[]>([]);
	const [websites, setWebsites] = useState<WebsiteEntry[]>([]);
	const [filtersExpanded, setFiltersExpanded] = useState(false);
	const filtersRef = useRef(filters);
	const debounceRef = useRef<NodeJS.Timeout>();

	filtersRef.current = filters;

	const updateFilters = useCallback(
		(next: Partial<typeof filters>) => {
			setFilters({ ...filtersRef.current, ...next });
		},
		[setFilters],
	);

	const refreshLists = useCallback(async () => {
		if (!window.api) return;

		const current = filtersRef.current;
		const [projectsAll, appsAll, websitesAll, facets] = await Promise.all([
			window.api.storage.getProjects(),
			window.api.storage.getApps(),
			window.api.storage.getWebsites(),
			window.api.storage.getTimelineFacets({
				startDate: filters.startDate,
				endDate: filters.endDate,
			}),
		]);

		const projectSetAll = new Set(projectsAll);
		const appSetAll = new Set(appsAll.map((a) => a.bundleId));
		const websiteSetAll = new Set(websitesAll.map((w) => w.host));

		const nextFilters = {
			...current,
			project:
				current.project && !projectSetAll.has(current.project)
					? undefined
					: current.project,
			appBundleId:
				current.appBundleId && !appSetAll.has(current.appBundleId)
					? undefined
					: current.appBundleId,
			urlHost:
				current.urlHost && !websiteSetAll.has(current.urlHost)
					? undefined
					: current.urlHost,
		};

		if (
			nextFilters.project !== filtersRef.current.project ||
			nextFilters.appBundleId !== filtersRef.current.appBundleId ||
			nextFilters.urlHost !== filtersRef.current.urlHost
		) {
			setFilters(nextFilters);
		}

		const selectedProject = nextFilters.project;
		const selectedAppBundleId = nextFilters.appBundleId;
		const selectedHost = nextFilters.urlHost;

		const nextProjects = (() => {
			if (
				!selectedProject ||
				facets.projects.includes(selectedProject) ||
				!projectSetAll.has(selectedProject)
			)
				return facets.projects;
			return [...facets.projects, selectedProject].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base" }),
			);
		})();

		const nextApps = (() => {
			if (
				!selectedAppBundleId ||
				facets.apps.some((a) => a.bundleId === selectedAppBundleId) ||
				!appSetAll.has(selectedAppBundleId)
			)
				return facets.apps;
			const selected =
				appsAll.find((a) => a.bundleId === selectedAppBundleId) ??
				({
					bundleId: selectedAppBundleId,
					name: null,
					appIconPath: null,
				} satisfies RecordedApp);
			return [...facets.apps, selected].sort((a, b) =>
				appLabel(a).localeCompare(appLabel(b), undefined, {
					sensitivity: "base",
				}),
			);
		})();

		const nextWebsites = (() => {
			if (
				!selectedHost ||
				facets.websites.some((w) => w.host === selectedHost) ||
				!websiteSetAll.has(selectedHost)
			)
				return facets.websites;
			const selected =
				websitesAll.find((w) => w.host === selectedHost) ??
				({ host: selectedHost, faviconPath: null } satisfies WebsiteEntry);
			return [...facets.websites, selected].sort((a, b) =>
				a.host.localeCompare(b.host, undefined, { sensitivity: "base" }),
			);
		})();

		setProjects((prev) =>
			areStringArraysEqual(prev, nextProjects) ? prev : nextProjects,
		);
		setApps((prev) => (areAppsEqual(prev, nextApps) ? prev : nextApps));
		setWebsites((prev) =>
			areWebsitesEqual(prev, nextWebsites) ? prev : nextWebsites,
		);
	}, [filters.endDate, filters.startDate, setFilters]);

	useEffect(() => {
		if (!window.api) return;

		const unsubscribeProjects = window.api.on(
			"projects:normalized",
			refreshLists,
		);
		const unsubscribeCreated = window.api.on("event:created", refreshLists);
		const unsubscribeUpdated = window.api.on("event:updated", refreshLists);
		const unsubscribeChanged = window.api.on("events:changed", refreshLists);
		return () => {
			unsubscribeProjects();
			unsubscribeCreated();
			unsubscribeUpdated();
			unsubscribeChanged();
		};
	}, [refreshLists]);

	useEffect(() => {
		void refreshLists();
	}, [refreshLists]);

	useEffect(() => {
		setSearch(filters.search ?? "");
	}, [filters.search]);

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);

		debounceRef.current = setTimeout(() => {
			const current = filtersRef.current;
			if (search !== (current.search || "")) {
				setFilters({ ...current, search: search || undefined });
			}
		}, 500);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [search, setFilters]);

	const handleDateRangeChange = useCallback(
		(start?: number, end?: number) => {
			updateFilters({ startDate: start, endDate: end });
		},
		[updateFilters],
	);

	const handleCategoryChange = useCallback(
		(v?: string) => updateFilters({ category: v }),
		[updateFilters],
	);
	const handleProjectChange = useCallback(
		(v?: string) => updateFilters({ project: v }),
		[updateFilters],
	);
	const handleAppChange = useCallback(
		(v?: string) => updateFilters({ appBundleId: v }),
		[updateFilters],
	);
	const handleWebsiteChange = useCallback(
		(v?: string) => updateFilters({ urlHost: v }),
		[updateFilters],
	);
	const toggleProgress = useCallback(() => {
		updateFilters({
			projectProgress: filtersRef.current.projectProgress ? undefined : true,
		});
	}, [updateFilters]);
	const toggleNeedsReview = useCallback(() => {
		updateFilters({
			needsAddictionReview: filtersRef.current.needsAddictionReview
				? undefined
				: true,
		});
	}, [updateFilters]);

	const projectOptions = useMemo(
		() => projects.map((p) => ({ value: p, label: p })),
		[projects],
	);
	const appOptions = useMemo(
		() =>
			apps.map((a) => ({
				value: a.bundleId,
				label: appLabel(a),
				icon: a.appIconPath ? (
					<img
						src={`local-file://${a.appIconPath}`}
						alt=""
						className="h-4 w-4 shrink-0 rounded-sm object-contain"
						loading="lazy"
					/>
				) : (
					<AppWindow className="h-4 w-4" />
				),
			})),
		[apps],
	);
	const websiteOptions = useMemo(
		() =>
			websites.map((w) => ({
				value: w.host,
				label: w.host,
				icon: w.faviconPath ? (
					<img
						src={`local-file://${w.faviconPath}`}
						alt=""
						className="h-4 w-4 shrink-0 rounded-sm object-contain"
						loading="lazy"
					/>
				) : (
					<Globe className="h-4 w-4" />
				),
			})),
		[websites],
	);

	const activeFilters = useMemo<ActiveFilter[]>(() => {
		const result: ActiveFilter[] = [];

		if (filters.category) {
			const Icon =
				CATEGORY_ICON[filters.category as keyof typeof CATEGORY_ICON];
			result.push({
				key: "category",
				label: filters.category,
				icon: <Icon className="h-3 w-3" />,
				onRemove: () => updateFilters({ category: undefined }),
			});
		}

		if (filters.project) {
			result.push({
				key: "project",
				label: filters.project,
				onRemove: () => updateFilters({ project: undefined }),
			});
		}

		if (filters.appBundleId) {
			const app = apps.find((a) => a.bundleId === filters.appBundleId);
			result.push({
				key: "app",
				label: app ? appLabel(app) : filters.appBundleId,
				icon: app?.appIconPath ? (
					<img
						src={`local-file://${app.appIconPath}`}
						alt=""
						className="h-3 w-3 shrink-0 rounded-sm object-contain"
					/>
				) : (
					<AppWindow className="h-3 w-3" />
				),
				onRemove: () => updateFilters({ appBundleId: undefined }),
			});
		}

		if (filters.urlHost) {
			const website = websites.find((w) => w.host === filters.urlHost);
			result.push({
				key: "website",
				label: filters.urlHost,
				icon: website?.faviconPath ? (
					<img
						src={`local-file://${website.faviconPath}`}
						alt=""
						className="h-3 w-3 shrink-0 rounded-sm object-contain"
					/>
				) : (
					<Globe className="h-3 w-3" />
				),
				onRemove: () => updateFilters({ urlHost: undefined }),
			});
		}

		if (filters.projectProgress) {
			result.push({
				key: "progress",
				label: "Progress",
				icon: <TrendingUp className="h-3 w-3" />,
				onRemove: () => updateFilters({ projectProgress: undefined }),
			});
		}

		if (filters.needsAddictionReview) {
			result.push({
				key: "needsReview",
				label: "Needs Review",
				icon: <AlertCircle className="h-3 w-3" />,
				onRemove: () => updateFilters({ needsAddictionReview: undefined }),
			});
		}

		return result;
	}, [apps, filters, websites, updateFilters]);

	const advancedFilterCount = activeFilters.length;
	const hasAnyFilters = useMemo(() => {
		const today = getTodayFilters();
		const isDefaultDateRange =
			filters.startDate === today.startDate &&
			filters.endDate === today.endDate;

		return (
			advancedFilterCount > 0 || Boolean(filters.search) || !isDefaultDateRange
		);
	}, [advancedFilterCount, filters.endDate, filters.search, filters.startDate]);

	return (
		<div className="border-b border-border">
			<div className="drag-region flex items-start justify-between gap-4 p-2 px-4">
				<div className="flex min-w-0 flex-col">
					<h1 className="text-lg font-semibold">Timeline</h1>
					<p className="text-sm text-muted-foreground">
						Review your captured activity and screenshots
					</p>
				</div>

				<div className="flex flex-wrap items-center justify-end gap-2 no-drag pt-2">
					<div className="relative w-[280px] max-w-full no-drag">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search captions, tags..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="h-8 pl-9 pr-8 text-xs"
						/>
						{search && (
							<button
								type="button"
								onClick={() => setSearch("")}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						)}
					</div>

					<DateRangeSelect
						startDate={filters.startDate}
						endDate={filters.endDate}
						onChange={handleDateRangeChange}
					/>

					<Button
						variant={
							filtersExpanded || advancedFilterCount > 0
								? "secondary"
								: "outline"
						}
						size="sm"
						className={cn(
							"h-8 gap-2 no-drag",
							advancedFilterCount > 0 &&
								"bg-primary/10 text-primary hover:bg-primary/20",
						)}
						onClick={() => setFiltersExpanded(!filtersExpanded)}
					>
						<SlidersHorizontal className="h-4 w-4" />
						Filters
						{advancedFilterCount > 0 && (
							<span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
								{advancedFilterCount}
							</span>
						)}
					</Button>

					{hasAnyFilters && (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 text-xs text-muted-foreground hover:text-foreground no-drag"
							onClick={clearFilters}
						>
							Clear all
						</Button>
					)}
				</div>
			</div>

			{filtersExpanded && (
				<div className="px-4 pb-3">
					<div className="flex flex-wrap items-center gap-2">
						<Combobox
							value={filters.category}
							onValueChange={handleCategoryChange}
							placeholder="Category"
							allLabel="All Categories"
							allIcon={<Tag className="h-4 w-4" />}
							searchable={false}
							options={CATEGORY_OPTIONS}
							className="w-[150px] no-drag"
						/>

						{projects.length > 0 && (
							<Combobox
								value={filters.project}
								onValueChange={handleProjectChange}
								placeholder="Project"
								allLabel="All Projects"
								searchable
								searchPlaceholder="Search projects..."
								emptyText="No projects."
								options={projectOptions}
								className="w-[150px] no-drag"
							/>
						)}

						{apps.length > 0 && (
							<Combobox
								value={filters.appBundleId}
								onValueChange={handleAppChange}
								placeholder="App"
								allLabel="All Apps"
								searchable
								searchPlaceholder="Search apps..."
								emptyText="No apps."
								options={appOptions}
								className="w-[180px] no-drag"
							/>
						)}

						{websites.length > 0 && (
							<Combobox
								value={filters.urlHost}
								onValueChange={handleWebsiteChange}
								placeholder="Website"
								allLabel="All Websites"
								allIcon={<Globe className="h-4 w-4" />}
								searchable
								searchPlaceholder="Search websites..."
								emptyText="No websites."
								dropdownMinWidth={200}
								options={websiteOptions}
								className="w-[160px] no-drag"
							/>
						)}

						<Button
							variant={filters.projectProgress ? "secondary" : "outline"}
							size="sm"
							className={cn(
								"h-8 gap-2 no-drag",
								filters.projectProgress &&
									"bg-primary/20 text-primary hover:bg-primary/30",
							)}
							onClick={toggleProgress}
						>
							<TrendingUp className="h-4 w-4" />
							Progress only
						</Button>

						<Button
							variant={filters.needsAddictionReview ? "secondary" : "outline"}
							size="sm"
							className={cn(
								"h-8 gap-2 no-drag",
								filters.needsAddictionReview &&
									"bg-orange-500/20 text-orange-500 hover:bg-orange-500/30",
							)}
							onClick={toggleNeedsReview}
						>
							<AlertCircle className="h-4 w-4" />
							Needs Review
						</Button>
					</div>
				</div>
			)}

			{activeFilters.length > 0 && (
				<div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
					{activeFilters.map((filter) => (
						<button
							key={filter.key}
							type="button"
							onClick={filter.onRemove}
							className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs transition-colors hover:bg-muted/50 group"
						>
							{filter.icon}
							<span>{filter.label}</span>
							<X className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
						</button>
					))}
				</div>
			)}
		</div>
	);
});
