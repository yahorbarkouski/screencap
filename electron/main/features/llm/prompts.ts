import { SELF_APP_BUNDLE_ID, SELF_APP_NAME } from "../../../shared/appIdentity";
import type { Memory } from "../../../shared/types";

export type AddictionOption = { id: string; name: string; definition: string };

export interface ScreenContext {
	appBundleId: string | null;
	appName: string | null;
	windowTitle: string | null;
	urlHost: string | null;
	contentKind: string | null;
	contentTitle: string | null;
	userCaption: string | null;
	selectedProject: string | null;
}

function compactText(value: string | null, maxChars: number): string | null {
	const normalized = (value ?? "").replace(/\s+/g, " ").trim();
	if (!normalized) return null;
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatScreenContext(context: ScreenContext | null): string | null {
	if (!context) return null;
	const parts: string[] = [];
	if (context.appName) parts.push(`App: ${context.appName}`);
	if (context.appBundleId) parts.push(`App bundle: ${context.appBundleId}`);
	if (context.windowTitle) parts.push(`Window: ${context.windowTitle}`);
	if (context.urlHost) parts.push(`Site: ${context.urlHost}`);
	if (context.contentKind)
		parts.push(`Content type: ${context.contentKind.replace(/_/g, " ")}`);
	if (context.contentTitle)
		parts.push(`Content title: ${context.contentTitle}`);
	const selectedProject = compactText(context.selectedProject, 200);
	if (selectedProject) parts.push(`Selected project: ${selectedProject}`);
	const userCaption = compactText(context.userCaption, 500);
	if (userCaption) parts.push(`User caption: ${userCaption}`);
	return parts.length > 0 ? parts.join("\n") : null;
}

function buildAddictionDefinition(
	name: string,
	description?: string | null,
): string {
	const about = description?.trim();
	if (!about) return name;
	return `${name}\nAbout: ${about}`;
}

function formatAddictionListItem(option: AddictionOption): string {
	const lines = option.definition
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	const first = lines[0] ?? option.name;
	const rest = lines.slice(1);
	if (rest.length === 0) return `- ${option.id}: ${first}`;
	return `- ${option.id}: ${first}\n  ${rest.join("\n  ")}`;
}

export function buildAddictionOptions(memories: Memory[]): AddictionOption[] {
	return memories
		.filter((m) => m.type === "addiction")
		.map((m) => ({
			id: m.id,
			name: m.content,
			definition: buildAddictionDefinition(m.content, m.description),
		}));
}

export function buildSystemPromptStage1(
	memories: Memory[],
	addictions: AddictionOption[],
	context: ScreenContext | null,
): string {
	const projects = memories
		.filter((m) => m.type === "project")
		.map((m) => m.content);
	const preferences = memories
		.filter((m) => m.type === "preference")
		.map((m) => m.content);

	let prompt = `You are an intelligent screen activity classifier.

Return ONLY valid JSON matching this schema:
{
  "category": "Study" | "Work" | "Leisure" | "Chores" | "Social" | "Unknown",
  "subcategories": string[],
  "project": string | null,
  "project_progress": {
    "shown": boolean,
    "confidence": number
  },
  "potential_progress": boolean,
  "tags": string[],
  "confidence": number,
  "caption": string,
  "addiction_triage": {
    "tracking_enabled": boolean,
    "potentially_addictive": boolean,
    "candidates": Array<{
      "addiction_id": string,
      "likelihood": number,
      "evidence": string[],
      "rationale": string
    }>
  }
}

Rules:
- "caption" must be a concise, descriptive title (3-8 words) describing the specific activity. Be precise: instead of "Watching a video", write "Watching 'How to Build Apps' tutorial". Instead of "Browsing website", write "Reading HN discussion on Rust". Use the provided context (app name, window title, content title) to be specific. If context provides a content title, incorporate it naturally.
- "potentially_addictive" is true if the screenshot appears to contain commonly addictive content (games, social media feeds, short-form video, gambling, porn, doomscrolling, etc).
- "tracking_enabled" must be true when TRACKED ADDICTIONS is not "none" and the screenshot is not a meta/review screen. It must be false otherwise. Meta/review screens include addiction lists, addiction definitions, trackers/analytics, settings, or reviewing prior addiction signals, even if addiction names are visible as text.
- If the screenshot is from ${SELF_APP_NAME} (${SELF_APP_BUNDLE_ID}), it is a meta/review screen and "tracking_enabled" MUST be false.
- If "tracking_enabled" is false, "candidates" MUST be [].
- If "tracking_enabled" is true, "candidates" MUST be a subset of the provided addiction list (by addiction_id) and only include plausible matches.
- Be strict: if you cannot point to concrete visual signals, lower likelihood and/or omit the candidate.
- "project" must be exactly one of the provided project names, or null.
- If a "Selected project" is provided in CURRENT CONTEXT, you MUST set "project" to that exact value.
- "project_progress" describes whether this screenshot shows a visual artifact of progress for the selected "project" (something a stakeholder could see: the project's UI, design mockups, prototypes, a running app, a website/staging page).
- Do NOT require novelty. You cannot know what is "new" from a single screenshot. If it is the project's UI/prototype/design, it counts as progress evidence.
- If "project" is null, "project_progress" MUST be {"shown": false, "confidence": 0} and "potential_progress" MUST be false.
- Do NOT count implementation work as progress: code editors, terminals, logs, issue trackers, or Git diffs are NOT progress evidence.
- Plain text docs (Notion/Docs/Markdown) are NOT progress evidence, but text-heavy screens inside the project's UI (dashboards, analytics, journal, settings) ARE progress evidence.
- If "project_progress.shown" is false, "project_progress.confidence" MUST be 0.
- "potential_progress" is true if the user is actively working on the selected project (coding, writing docs, terminal commands, issue tracking, research, design work) but not showing a visual artifact. This is work that may lead to progress but is not yet visible to stakeholders.
- If "project_progress.shown" is true, "potential_progress" MUST be false (already confirmed progress).

Categories:
- Study: Learning, courses, reading educational content, research
- Work: Professional tasks, coding, emails, documents, meetings
- Leisure: Entertainment, games, social media scrolling, videos
- Chores: Personal admin, bills, shopping, scheduling
- Social: Communication, messaging, calls
- Unknown: Cannot determine`;

	if (context) {
		const formatted = formatScreenContext(context);
		if (formatted) prompt += `\n\nCURRENT CONTEXT:\n${formatted}`;
	}

	if (addictions.length > 0) {
		prompt += `\n\nTRACKED ADDICTIONS (id -> definition):\n${addictions.map(formatAddictionListItem).join("\n")}`;
	} else {
		prompt += `\n\nTRACKED ADDICTIONS: none`;
	}

	if (projects.length > 0) {
		prompt += `\n\nUSER'S ACTIVE PROJECTS:\n${projects.map((p) => `- ${p}`).join("\n")}`;
	}

	if (preferences.length > 0) {
		prompt += `\n\nUSER PREFERENCES:\n${preferences.map((p) => `- ${p}`).join("\n")}`;
	}

	return prompt;
}

export function buildSystemPromptStage1TextOnly(
	memories: Memory[],
	addictions: AddictionOption[],
	context: ScreenContext | null,
): string {
	const projects = memories
		.filter((m) => m.type === "project")
		.map((m) => m.content);
	const preferences = memories
		.filter((m) => m.type === "preference")
		.map((m) => m.content);

	let prompt = `You are an intelligent screen activity classifier.
You do NOT see screenshot pixels. You only see structured context metadata and optional OCR text.

Return ONLY valid JSON matching this schema:
{
  "category": "Study" | "Work" | "Leisure" | "Chores" | "Social" | "Unknown",
  "subcategories": string[],
  "project": string | null,
  "project_progress": {
    "shown": boolean,
    "confidence": number
  },
  "potential_progress": boolean,
  "tags": string[],
  "confidence": number,
  "caption": string,
  "addiction_triage": {
    "tracking_enabled": boolean,
    "potentially_addictive": boolean,
    "candidates": Array<{
      "addiction_id": string,
      "likelihood": number,
      "evidence": string[],
      "rationale": string
    }>
  }
}

Rules:
- "caption" must be a concise, descriptive title (3-8 words) describing the specific activity. Use context and OCR text to be specific.
- Be conservative when metadata is ambiguous. If unsure, use category "Unknown" and confidence <= 0.4.
- "potentially_addictive" is true if context or OCR indicates commonly addictive content (games, social feeds, short-form video, gambling, porn, doomscrolling).
- "tracking_enabled" must be true when TRACKED ADDICTIONS is not "none" and the activity is not a meta/review screen. It must be false otherwise.
- If the activity is from ${SELF_APP_NAME} (${SELF_APP_BUNDLE_ID}), it is a meta/review screen and "tracking_enabled" MUST be false.
- If "tracking_enabled" is false, "candidates" MUST be [].
- If "tracking_enabled" is true, "candidates" MUST be a subset of the provided addiction list (by addiction_id) and only include plausible matches.
- "evidence" must cite concrete phrases from OCR text and/or specific context fields.
- "project" must be exactly one of the provided project names, or null.
- If a "Selected project" is provided in CURRENT CONTEXT, you MUST set "project" to that exact value.
- "project_progress" describes whether this activity shows a stakeholder-visible artifact for the selected "project". In text-only mode, infer from app/site and titles (e.g., Figma designs, a running app page, staging site) and be conservative.
- If "project" is null, "project_progress" MUST be {"shown": false, "confidence": 0} and "potential_progress" MUST be false.
- If "project_progress.shown" is false, "project_progress.confidence" MUST be 0.
- "potential_progress" is true if the user is actively working on the selected project (coding, writing docs, terminal commands, issue tracking, research, design work) but not showing a visual artifact. This is work that may lead to progress but is not yet visible to stakeholders.
- If "project_progress.shown" is true, "potential_progress" MUST be false (already confirmed progress).

Categories:
- Study: Learning, courses, reading educational content, research
- Work: Professional tasks, coding, emails, documents, meetings
- Leisure: Entertainment, games, social media scrolling, videos
- Chores: Personal admin, bills, shopping, scheduling
- Social: Communication, messaging, calls
- Unknown: Cannot determine`;

	if (context) {
		const formatted = formatScreenContext(context);
		if (formatted) prompt += `\n\nCURRENT CONTEXT:\n${formatted}`;
	}

	if (addictions.length > 0) {
		prompt += `\n\nTRACKED ADDICTIONS (id -> definition):\n${addictions.map(formatAddictionListItem).join("\n")}`;
	} else {
		prompt += `\n\nTRACKED ADDICTIONS: none`;
	}

	if (projects.length > 0) {
		prompt += `\n\nUSER'S ACTIVE PROJECTS:\n${projects.map((p) => `- ${p}`).join("\n")}`;
	}

	if (preferences.length > 0) {
		prompt += `\n\nUSER PREFERENCES:\n${preferences.map((p) => `- ${p}`).join("\n")}`;
	}

	return prompt;
}

export function buildSystemPromptStage2(
	candidates: AddictionOption[],
	context: ScreenContext | null,
): string {
	const list =
		candidates.length === 0
			? "none"
			: `\n${candidates.map(formatAddictionListItem).join("\n")}`;

	let prompt = `You are an addiction verifier. You must be strict and only confirm an addiction if the screenshot shows the user actually engaging in the addictive activity described by the user's definition.
Meta/review screens (addiction lists, addiction definitions, trackers/analytics, settings, or reviewing prior addiction signals) are NOT the addiction itself.

Return ONLY valid JSON matching this schema:
{
  "decision": "none" | "confirmed" | "candidate",
  "addiction_id": string | null,
  "confidence": number,
  "evidence": string[],
  "manual_prompt": string | null
}

Rules:
- You will be given candidate addictions as (id -> definition). You may only choose addiction_id from that list.
- Do NOT confirm based only on the addiction name appearing as text; require UI/visual evidence of the addictive activity itself.
- If you cannot confidently verify the constraints from the screenshot, do NOT confirm. Use "candidate" with a helpful "manual_prompt" explaining what the user should add to their addiction definition to make detection reliable.
- If the screenshot is from ${SELF_APP_NAME} (${SELF_APP_BUNDLE_ID}), decision MUST be "none".
- "manual_prompt" must be null when decision is "none" or "confirmed".
- Keep "evidence" to short, concrete, screenshot-grounded statements.
`;

	if (context) {
		const formatted = formatScreenContext(context);
		if (formatted) prompt += `\n\nCURRENT CONTEXT:\n${formatted}\n`;
	}

	prompt += `\nCANDIDATE ADDICTIONS (id -> definition): ${list}`;
	return prompt;
}

export function buildStoryPrompt(periodType: "daily" | "weekly"): string {
	const unit = periodType === "daily" ? "day" : "week";
	const title = periodType === "daily" ? "DAY WRAPPED" : "WEEK WRAPPED";

	return `You generate a minimal, high-signal ${periodType} summaries report: a ${unit} journal overview of a user's screen activity.
Focus on productivity, categories, project progress, addiction risk, and concrete improvement opportunities.

Output constraints:
- Plain text only. No Markdown.
- Short lines. No long paragraphs.
- Use subtle ASCII styling (e.g., dots, separators) but keep it readable.
- Be honest and specific. No generic motivational fluff.
- Ground every claim in the provided event list.
- Some events may include markers like "project:<name>" and "progress:true". If present, include the most meaningful progress milestones in HIGHLIGHTS.

Structure:
${title}
<one-line tagline>

AT A GLANCE
- <3-6 bullets with concrete metrics / ratios inferred from events>

HIGHLIGHTS
- <3-6 bullets referencing specific activities/captions>

PATTERNS
- <2-4 bullets about focus, context switching, distraction patterns>

TOMORROW
- <1-3 actionable suggestions>
`;
}

export interface ReminderContext {
	userText: string;
	ocrText: string | null;
	appBundleId: string | null;
	windowTitle: string | null;
	urlHost: string | null;
	contentKind: string | null;
	hasImage: boolean;
	currentDateTime: string;
	timezone: string;
}

export function buildReminderParsePrompt(context: ReminderContext): string {
	const contextParts: string[] = [];

	if (context.windowTitle) {
		contextParts.push(`Window: ${context.windowTitle}`);
	}
	if (context.urlHost) {
		contextParts.push(`Website: ${context.urlHost}`);
	}
	if (context.contentKind) {
		contextParts.push(`Content: ${context.contentKind}`);
	}
	if (context.ocrText) {
		const truncatedOcr = context.ocrText.slice(0, 1000);
		contextParts.push(`Text from screen:\n${truncatedOcr}`);
	}

	const contextSection =
		contextParts.length > 0
			? `\nCAPTURED CONTEXT:\n${contextParts.join("\n")}`
			: "";

	return `You parse user input into structured reminders/notes.

You are given a screenshot of the captured region${context.hasImage ? "" : " (no image was provided)"}.
If an image is provided, use it to identify people, objects, or places when relevant.
If you confidently recognize a person, include their full name and a short, accurate 1-2 sentence context in the body.
If recognition is uncertain, do not guess; keep the body generic.

Current date/time: ${context.currentDateTime}
Timezone: ${context.timezone}

USER INPUT:
${context.userText}
${contextSection}

Return ONLY valid JSON matching this schema:
{
  "title": string,      // Short title (max 100 chars), summarizing the reminder/note
  "body": string | null, // Full description if needed, or null
  "isReminder": boolean, // true if user wants to be reminded at a specific time
  "remindAt": string | null, // ISO 8601 datetime string if isReminder is true, null otherwise
  "confidence": number  // 0-1, how confident you are in the interpretation
}

Guidelines:
- If user mentions a time like "in 2 hours", "tomorrow at 9am", "next Monday", compute the actual datetime
- If user asks to be reminded but doesn't give a time, infer a reasonable reminder time within the next 24 hours
- If user just wants to save a note without reminder, set isReminder: false
- Extract a concise title from the user's intent
- If a person/place/object is identifiable from the image, include the identified name and add 2-4 concise bullet topics to read about
- Keep the body concise and actionable
`;
}
