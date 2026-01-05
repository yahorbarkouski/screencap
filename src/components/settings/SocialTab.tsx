import { useCallback, useEffect, useState } from "react";
import { AvatarPicker } from "@/components/settings/AvatarPicker";
import {
	SettingsRow,
	SettingsRows,
	SettingsTabHeader,
} from "@/components/settings/SettingsPrimitives";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Panel } from "@/components/wrapped/Panel";
import { cn } from "@/lib/utils";
import type { AvatarSettings, Settings, SocialIdentity } from "@/types";

interface SocialTabProps {
	settings: Settings;
	updateSetting: <K extends keyof Settings>(
		key: K,
		value: Settings[K],
	) => Promise<void>;
}

export function SocialTab({ settings, updateSetting }: SocialTabProps) {
	const [identity, setIdentity] = useState<SocialIdentity | null>(null);

	useEffect(() => {
		window.api?.social.getIdentity().then(setIdentity);
	}, []);

	const handleAvatarChange = useCallback(
		async (avatar: AvatarSettings) => {
			await updateSetting("avatar", avatar);
			try {
				await window.api?.social.syncAvatarSettings(avatar);
			} catch {}
		},
		[updateSetting],
	);

	return (
		<TabsContent value="social" className="p-6 m-0">
			<div className="space-y-6">
				<SettingsTabHeader
					title="Social"
					description="Control sharing preferences and what friends can see"
				/>

				{identity && (
					<Panel
						title="Avatar"
						meta="Customize your profile appearance"
						className="max-w-3xl"
					>
						<AvatarPicker
							username={identity.username}
							settings={settings.avatar}
							onChange={handleAvatarChange}
						/>
					</Panel>
				)}

				<Panel
					title="Friend Sharing Privacy"
					meta="Control what info is shared with friends"
					className="max-w-3xl"
				>
					<SettingsRows>
						<SettingsRow
							title="Include app name"
							description="Share which app you're using (e.g. VS Code, Chrome)"
							right={
								<Switch
									checked={settings.sharing?.includeAppName ?? true}
									onCheckedChange={(checked) =>
										updateSetting("sharing", {
											...settings.sharing,
											includeAppName: checked,
										})
									}
								/>
							}
						/>
						<SettingsRow
							title="Include window title"
							description="Share the window title (may contain file names, URLs)"
							right={
								<Switch
									checked={settings.sharing?.includeWindowTitle ?? false}
									onCheckedChange={(checked) =>
										updateSetting("sharing", {
											...settings.sharing,
											includeWindowTitle: checked,
										})
									}
								/>
							}
						/>
						<SettingsRow
							title="Include content info"
							description="Share content context (e.g. Spotify track, video title)"
							right={
								<Switch
									checked={settings.sharing?.includeContentInfo ?? true}
									onCheckedChange={(checked) =>
										updateSetting("sharing", {
											...settings.sharing,
											includeContentInfo: checked,
										})
									}
								/>
							}
						/>
					</SettingsRows>
				</Panel>

				<Panel
					title="Day Wrapped Sharing"
					meta="Auto-publish every 15 minutes"
					className="max-w-3xl"
				>
					<div className="space-y-4">
						<SettingsRows>
							<SettingsRow
								title="Share Day Wrapped"
								description="Let friends see your Dayline summary (published automatically)"
								right={
									<Switch
										checked={settings.social.dayWrapped.enabled}
										onCheckedChange={async (checked) => {
											await updateSetting("social", {
												...settings.social,
												dayWrapped: {
													...settings.social.dayWrapped,
													enabled: checked,
												},
											});
											if (checked) {
												await window.api?.socialFeed.ensureFriendsFeedRoom();
											}
										}}
									/>
								}
							/>
						</SettingsRows>

						<div
							className={cn(
								"space-y-0",
								!settings.social.dayWrapped.enabled &&
									"opacity-60 pointer-events-none",
							)}
						>
							<SettingsRows>
								<SettingsRow
									title="Include apps"
									description="Share dominant apps in your Day Wrapped"
									right={
										<Switch
											checked={settings.social.dayWrapped.includeApps}
											onCheckedChange={(checked) =>
												updateSetting("social", {
													...settings.social,
													dayWrapped: {
														...settings.social.dayWrapped,
														includeApps: checked,
													},
												})
											}
										/>
									}
								/>
								<SettingsRow
									title="Include addictions"
									description="Share addiction labels in your Day Wrapped"
									right={
										<Switch
											checked={settings.social.dayWrapped.includeAddiction}
											onCheckedChange={(checked) =>
												updateSetting("social", {
													...settings.social,
													dayWrapped: {
														...settings.social.dayWrapped,
														includeAddiction: checked,
													},
												})
											}
										/>
									}
								/>
							</SettingsRows>
						</div>
					</div>
				</Panel>
			</div>
		</TabsContent>
	);
}
