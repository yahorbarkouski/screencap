import type { Event } from "@/types";

function parseStringArrayJson(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
}

function includesPornTerm(value: string | null | undefined): boolean {
	const v = (value ?? "").toLowerCase();
	return v.includes("porn") || v.includes("nsfw") || v.includes("adult");
}

export function isNsfwEvent(
	event: Pick<
		Event,
		"tags" | "urlHost" | "urlCanonical" | "contentTitle" | "windowTitle"
	>,
): boolean {
	const tags = parseStringArrayJson(event.tags);
	if (
		tags.some((tag) => {
			const t = tag.toLowerCase();
			return t === "porn" || t === "nsfw" || t === "adult";
		})
	) {
		return true;
	}

	return (
		includesPornTerm(event.urlHost) ||
		includesPornTerm(event.urlCanonical) ||
		includesPornTerm(event.contentTitle) ||
		includesPornTerm(event.windowTitle)
	);
}
