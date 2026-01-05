import { useCallback, useEffect } from "react";
import { useAppStore } from "@/stores/app";
import type { Settings } from "@/types";

function mergeSettings(base: Settings, incoming: unknown): Settings {
	if (!incoming || typeof incoming !== "object") return base;
	const partial = incoming as Partial<Settings>;
	const next: Settings = { ...base, ...partial } as Settings;

	const incomingAutomationRules = partial.automationRules;
	next.automationRules = {
		apps: {
			...base.automationRules.apps,
			...(incomingAutomationRules?.apps ?? {}),
		},
		hosts: {
			...base.automationRules.hosts,
			...(incomingAutomationRules?.hosts ?? {}),
		},
	};

	const incomingOnboarding = partial.onboarding;
	next.onboarding = {
		version:
			incomingOnboarding?.version === undefined
				? base.onboarding.version
				: incomingOnboarding.version,
		completedAt:
			incomingOnboarding?.completedAt === undefined
				? base.onboarding.completedAt
				: incomingOnboarding.completedAt,
		lastStep:
			incomingOnboarding?.lastStep === undefined
				? base.onboarding.lastStep
				: incomingOnboarding.lastStep,
	};

	const incomingShortcuts = partial.shortcuts;
	next.shortcuts = {
		...base.shortcuts,
		...(incomingShortcuts ?? {}),
	};

	const incomingSharing = partial.sharing;
	next.sharing = {
		...base.sharing,
		...(incomingSharing ?? {}),
	};

	const incomingSocial = partial.social;
	next.social = {
		...base.social,
		...(incomingSocial ?? {}),
		dayWrapped: {
			...base.social.dayWrapped,
			...(incomingSocial?.dayWrapped ?? {}),
		},
	};

	const incomingAvatar = partial.avatar;
	next.avatar = {
		...base.avatar,
		...(incomingAvatar ?? {}),
	};

	return next;
}

export function useSettings() {
	const settings = useAppStore((s) => s.settings);
	const setSettings = useAppStore((s) => s.setSettings);
	const setSettingsLoaded = useAppStore((s) => s.setSettingsLoaded);

	const fetchSettings = useCallback(async () => {
		if (!window.api) {
			setSettingsLoaded(true);
			return;
		}
		try {
			const result = await window.api.settings.get();
			const base = useAppStore.getState().settings;
			setSettings(mergeSettings(base, result));
		} finally {
			setSettingsLoaded(true);
		}
	}, [setSettings, setSettingsLoaded]);

	const saveSettings = useCallback(
		async (newSettings: Settings) => {
			if (!window.api) return;
			await window.api.settings.set(newSettings);
			setSettings(newSettings);
		},
		[setSettings],
	);

	const updateSetting = useCallback(
		async <K extends keyof Settings>(key: K, value: Settings[K]) => {
			const newSettings = { ...settings, [key]: value };
			await saveSettings(newSettings);
		},
		[settings, saveSettings],
	);

	useEffect(() => {
		fetchSettings();
	}, [fetchSettings]);

	return { settings, fetchSettings, saveSettings, updateSetting };
}
