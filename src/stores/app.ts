import { endOfDay, startOfDay } from "date-fns";
import { create } from "zustand";
import type {
	Event,
	EventFilters,
	Memory,
	Settings,
	SettingsTab,
	Story,
	View,
} from "@/types";

export function getTodayFilters(): Pick<EventFilters, "startDate" | "endDate"> {
	const now = new Date();
	return {
		startDate: startOfDay(now).getTime(),
		endDate: endOfDay(now).getTime(),
	};
}

function areEventFiltersEqual(a: EventFilters, b: EventFilters): boolean {
	return (
		a.category === b.category &&
		a.project === b.project &&
		a.projectProgress === b.projectProgress &&
		a.appBundleId === b.appBundleId &&
		a.urlHost === b.urlHost &&
		a.startDate === b.startDate &&
		a.endDate === b.endDate &&
		a.search === b.search &&
		a.dismissed === b.dismissed
	);
}

interface AppState {
	view: View;
	setView: (view: View) => void;

	settingsTab: SettingsTab;
	setSettingsTab: (tab: SettingsTab) => void;

	selectedProjectId: string | null;
	setSelectedProjectId: (id: string | null) => void;

	focusedAddictionId: string | null;
	setFocusedAddictionId: (id: string | null) => void;

	filters: EventFilters;
	setFilters: (filters: EventFilters) => void;
	clearFilters: () => void;

	pagination: { page: number; pageSize: number };
	setPagination: (next: Partial<{ page: number; pageSize: number }>) => void;

	events: Event[];
	setEvents: (events: Event[]) => void;
	addEvent: (event: Event) => void;
	updateEvent: (id: string, updates: Partial<Event>) => void;
	removeEvent: (id: string) => void;

	selectedEventIds: Set<string>;
	selectEvent: (id: string) => void;
	deselectEvent: (id: string) => void;
	toggleEventSelection: (id: string) => void;
	selectAllEvents: () => void;
	clearSelection: () => void;

	memories: Memory[];
	setMemories: (memories: Memory[]) => void;
	addMemory: (memory: Memory) => void;
	updateMemory: (
		id: string,
		updates: { content: string; description?: string | null },
	) => void;
	removeMemory: (id: string) => void;

	stories: Story[];
	setStories: (stories: Story[]) => void;
	addStory: (story: Story) => void;

	settings: Settings;
	setSettings: (settings: Settings) => void;
	settingsLoaded: boolean;
	setSettingsLoaded: (loaded: boolean) => void;

	hasPermission: boolean;
	setHasPermission: (has: boolean) => void;

	commandPaletteOpen: boolean;
	setCommandPaletteOpen: (open: boolean) => void;

	eodOpen: boolean;
	eodDayStart: number | null;
	openEod: (dayStart: number) => void;
	closeEod: () => void;
}

export const useAppStore = create<AppState>((set, _get) => ({
	view: "timeline",
	setView: (view) => set((state) => (state.view === view ? {} : { view })),

	settingsTab: "capture",
	setSettingsTab: (settingsTab) =>
		set((state) => (state.settingsTab === settingsTab ? {} : { settingsTab })),

	selectedProjectId: null,
	setSelectedProjectId: (selectedProjectId) =>
		set((state) =>
			state.selectedProjectId === selectedProjectId
				? {}
				: { selectedProjectId },
		),

	focusedAddictionId: null,
	setFocusedAddictionId: (focusedAddictionId) =>
		set((state) =>
			state.focusedAddictionId === focusedAddictionId
				? {}
				: { focusedAddictionId },
		),

	filters: getTodayFilters(),
	setFilters: (filters) =>
		set((state) =>
			areEventFiltersEqual(state.filters, filters)
				? {}
				: { filters, pagination: { ...state.pagination, page: 0 } },
		),
	clearFilters: () => {
		const todayFilters = getTodayFilters();
		return set((state) =>
			areEventFiltersEqual(state.filters, todayFilters)
				? {}
				: {
						filters: todayFilters,
						pagination: { ...state.pagination, page: 0 },
					},
		);
	},

	pagination: { page: 0, pageSize: 100 },
	setPagination: (next) =>
		set((state) => {
			const page = next.page ?? state.pagination.page;
			const pageSize = next.pageSize ?? state.pagination.pageSize;
			if (
				page === state.pagination.page &&
				pageSize === state.pagination.pageSize
			)
				return {};
			return { pagination: { page, pageSize } };
		}),

	events: [],
	setEvents: (events) => set({ events }),
	addEvent: (event) => set((state) => ({ events: [event, ...state.events] })),
	updateEvent: (id, updates) =>
		set((state) => ({
			events: state.events.map((e) => (e.id === id ? { ...e, ...updates } : e)),
		})),
	removeEvent: (id) =>
		set((state) => {
			const selectedEventIds = new Set(state.selectedEventIds);
			selectedEventIds.delete(id);
			return {
				events: state.events.filter((e) => e.id !== id),
				selectedEventIds,
			};
		}),

	selectedEventIds: new Set(),
	selectEvent: (id) =>
		set((state) => {
			if (state.selectedEventIds.has(id)) return {};
			const newSet = new Set(state.selectedEventIds);
			newSet.add(id);
			return { selectedEventIds: newSet };
		}),
	deselectEvent: (id) =>
		set((state) => {
			if (!state.selectedEventIds.has(id)) return {};
			const newSet = new Set(state.selectedEventIds);
			newSet.delete(id);
			return { selectedEventIds: newSet };
		}),
	toggleEventSelection: (id) =>
		set((state) => {
			const newSet = new Set(state.selectedEventIds);
			if (newSet.has(id)) {
				newSet.delete(id);
			} else {
				newSet.add(id);
			}
			return { selectedEventIds: newSet };
		}),
	selectAllEvents: () =>
		set((state) => ({
			selectedEventIds: new Set(state.events.map((e) => e.id)),
		})),
	clearSelection: () =>
		set((state) =>
			state.selectedEventIds.size === 0 ? {} : { selectedEventIds: new Set() },
		),

	memories: [],
	setMemories: (memories) => set({ memories }),
	addMemory: (memory) =>
		set((state) => ({ memories: [memory, ...state.memories] })),
	updateMemory: (id, updates) =>
		set((state) => ({
			memories: state.memories.map((m) =>
				m.id === id ? { ...m, ...updates, updatedAt: Date.now() } : m,
			),
		})),
	removeMemory: (id) =>
		set((state) => ({
			memories: state.memories.filter((m) => m.id !== id),
		})),

	stories: [],
	setStories: (stories) => set({ stories }),
	addStory: (story) => set((state) => ({ stories: [story, ...state.stories] })),

	settings: {
		apiKey: null,
		captureInterval: 5,
		retentionDays: 30,
		excludedApps: [],
		launchAtLogin: false,
		automationRules: { apps: {}, hosts: {} },
		onboarding: { version: 1, completedAt: null },
		shortcuts: {
			captureNow: "Command+Shift+O",
			captureProjectProgress: "Command+Shift+P",
			endOfDay: "Command+Shift+E",
		},
		llmEnabled: true,
		allowVisionUploads: true,
		cloudLlmModel: "openai/gpt-5",
		localLlmEnabled: false,
		localLlmBaseUrl: "http://localhost:11434/v1",
		localLlmModel: "llama3.2",
	},
	setSettings: (settings) => set({ settings }),
	settingsLoaded: false,
	setSettingsLoaded: (loaded) =>
		set((state) =>
			state.settingsLoaded === loaded ? {} : { settingsLoaded: loaded },
		),

	hasPermission: false,
	setHasPermission: (has) =>
		set((state) => (state.hasPermission === has ? {} : { hasPermission: has })),

	commandPaletteOpen: false,
	setCommandPaletteOpen: (open) =>
		set((state) =>
			state.commandPaletteOpen === open ? {} : { commandPaletteOpen: open },
		),

	eodOpen: false,
	eodDayStart: null,
	openEod: (dayStart) =>
		set((state) =>
			state.eodOpen && state.eodDayStart === dayStart
				? {}
				: { eodOpen: true, eodDayStart: dayStart },
		),
	closeEod: () => set((state) => (state.eodOpen ? { eodOpen: false } : {})),
}));
