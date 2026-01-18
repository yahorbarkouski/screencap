import { z } from "zod";

export const ClassificationStage1Schema = z.object({
	category: z.enum(["Study", "Work", "Leisure", "Chores", "Social", "Unknown"]),
	subcategories: z.array(z.string()),
	project: z.string().nullable(),
	project_progress: z.object({
		shown: z.boolean(),
		confidence: z.number().min(0).max(1),
	}),
	potential_progress: z.boolean(),
	tags: z.array(z.string()),
	confidence: z.number().min(0).max(1),
	caption: z.string(),
	addiction_triage: z.object({
		tracking_enabled: z.boolean(),
		potentially_addictive: z.boolean(),
		candidates: z.array(
			z.object({
				addiction_id: z.string(),
				likelihood: z.number().min(0).max(1),
				evidence: z.array(z.string()),
				rationale: z.string(),
			}),
		),
	}),
});

export type ClassificationStage1 = z.infer<typeof ClassificationStage1Schema>;

export const ClassificationStage2Schema = z.object({
	decision: z.enum(["none", "confirmed", "candidate"]),
	addiction_id: z.string().nullable(),
	confidence: z.number().min(0).max(1),
	evidence: z.array(z.string()),
	manual_prompt: z.string().nullable(),
});

export type ClassificationStage2 = z.infer<typeof ClassificationStage2Schema>;

export const ReminderParseSchema = z.object({
	title: z.string(),
	body: z.string().nullable(),
	isReminder: z.boolean(),
	remindAt: z.string().nullable(),
	confidence: z.number().min(0).max(1),
});

export type ReminderParse = z.infer<typeof ReminderParseSchema>;
