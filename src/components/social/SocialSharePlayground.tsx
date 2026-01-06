import { useState } from "react";
import { SocialShareCard, type SocialSharePayload } from "./SocialShareCard";

const PLACEHOLDER_IMAGE = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="50%" style="stop-color:#16213e"/>
      <stop offset="100%" style="stop-color:#0f3460"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <text x="960" y="540" font-family="system-ui" font-size="48" fill="rgba(255,255,255,0.3)" text-anchor="middle" dominant-baseline="middle">Screenshot Preview</text>
</svg>
`)}`;

const APP_ICON_PATH =
	"local-file:///Users/yahorbarkouski/Downloads/app-icon-25d-light.webp";

const SAMPLE_PAYLOAD: SocialSharePayload = {
	imageUrl: PLACEHOLDER_IMAGE,
	title: "Building the future of screen recording",
	timestamp: Date.now(),
	category: "Work",
	appName: "Cursor",
	appIconPath: APP_ICON_PATH,
	backgroundTitle: "Midnight City",
	backgroundArtist: "M83",
	backgroundImageUrl: null,
	websiteUrl: null,
};

export function SocialSharePlayground() {
	const [payload, setPayload] = useState<SocialSharePayload>(SAMPLE_PAYLOAD);

	const updatePayload = <K extends keyof SocialSharePayload>(
		key: K,
		value: SocialSharePayload[K],
	) => {
		setPayload((prev) => ({ ...prev, [key]: value }));
	};

	return (
		<div className="min-h-screen bg-neutral-950 text-white p-6">
			<div className="max-w-[1960px] mx-auto">
				<div className="mb-6 flex items-center justify-between">
					<h1 className="text-2xl font-bold">Social Share Playground</h1>
					<div className="text-sm text-white/50">
						Edit the fields below to preview the design
					</div>
				</div>

				<div className="grid grid-cols-[1fr_320px] gap-6">
					<div className="border border-white/10 rounded-xl overflow-hidden">
						<div className="transform origin-top-left scale-[0.5]">
							<SocialShareCard payload={payload} />
						</div>
					</div>

					<div className="space-y-4 bg-white/5 rounded-xl p-4 h-fit max-h-[85vh] overflow-y-auto">
						<h2 className="text-lg font-semibold border-b border-white/10 pb-2">
							Properties
						</h2>

						<Field label="Image URL">
							<input
								type="text"
								value={payload.imageUrl}
								onChange={(e) => updatePayload("imageUrl", e.target.value)}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
								placeholder="https://..."
							/>
						</Field>

						<Field label="Title">
							<input
								type="text"
								value={payload.title}
								onChange={(e) => updatePayload("title", e.target.value)}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
							/>
						</Field>

						<Field label="Category">
							<select
								value={payload.category ?? ""}
								onChange={(e) =>
									updatePayload("category", e.target.value || null)
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
							>
								<option value="">None</option>
								<option value="Work">Work</option>
								<option value="Study">Study</option>
								<option value="Leisure">Leisure</option>
								<option value="Chores">Chores</option>
								<option value="Social">Social</option>
							</select>
						</Field>

						<div className="border-t border-white/10 pt-4 mt-4">
							<div className="text-xs text-white/40 uppercase tracking-wider mb-3">
								App
							</div>
						</div>

						<Field label="App Name">
							<input
								type="text"
								value={payload.appName ?? ""}
								onChange={(e) =>
									updatePayload("appName", e.target.value || null)
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
								placeholder="e.g. Cursor, Figma..."
							/>
						</Field>

						<Field label="App Icon URL">
							<input
								type="text"
								value={payload.appIconPath ?? ""}
								onChange={(e) =>
									updatePayload("appIconPath", e.target.value || null)
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
								placeholder="local-file:// or https://..."
							/>
						</Field>

						<div className="border-t border-white/10 pt-4 mt-4">
							<div className="text-xs text-white/40 uppercase tracking-wider mb-3">
								Audio / Music
							</div>
						</div>

						<Field label="Song Title">
							<input
								type="text"
								value={payload.backgroundTitle ?? ""}
								onChange={(e) =>
									updatePayload("backgroundTitle", e.target.value || null)
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
								placeholder="e.g. Midnight City"
							/>
						</Field>

						<Field label="Artist">
							<input
								type="text"
								value={payload.backgroundArtist ?? ""}
								onChange={(e) =>
									updatePayload("backgroundArtist", e.target.value || null)
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
								placeholder="e.g. M83"
							/>
						</Field>

						<Field label="Album Art URL">
							<input
								type="text"
								value={payload.backgroundImageUrl ?? ""}
								onChange={(e) =>
									updatePayload("backgroundImageUrl", e.target.value || null)
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
								placeholder="local-file:// or https://..."
							/>
						</Field>

						<div className="border-t border-white/10 pt-4 mt-4">
							<div className="text-xs text-white/40 uppercase tracking-wider mb-3">
								Other
							</div>
						</div>

						<Field label="Website URL">
							<input
								type="text"
								value={payload.websiteUrl ?? ""}
								onChange={(e) =>
									updatePayload("websiteUrl", e.target.value || null)
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
								placeholder="e.g. github.com..."
							/>
						</Field>

						<Field label="Timestamp">
							<input
								type="datetime-local"
								value={new Date(payload.timestamp).toISOString().slice(0, 16)}
								onChange={(e) =>
									updatePayload("timestamp", new Date(e.target.value).getTime())
								}
								className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
							/>
						</Field>

						<div className="pt-4 border-t border-white/10">
							<button
								type="button"
								onClick={() => setPayload(SAMPLE_PAYLOAD)}
								className="w-full bg-white/10 hover:bg-white/20 rounded px-4 py-2 text-sm transition-colors"
							>
								Reset to Sample
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1">
			<label className="text-xs text-white/60">{label}</label>
			{children}
		</div>
	);
}
