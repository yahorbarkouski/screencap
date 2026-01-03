import type {
	EodContent,
	EodEntry,
	EodEntryInput,
} from "../../../../shared/types";
import { getDatabase, isDbOpen } from "../connection";
import { transformRows } from "../transformers";

type RawRow = Record<string, unknown>;

type EodEntryDbRow = {
	id: string;
	dayStart: number;
	dayEnd: number;
	schemaVersion: number;
	contentJson: string;
	createdAt: number;
	updatedAt: number;
	submittedAt: number | null;
};

function parseContent(raw: string): EodContent {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			(parsed as { version?: unknown }).version === 1 &&
			Array.isArray((parsed as { sections?: unknown }).sections)
		) {
			return parsed as EodContent;
		}
	} catch {}
	return { version: 1, sections: [] };
}

function toEntry(row: EodEntryDbRow): EodEntry {
	return {
		id: row.id,
		dayStart: row.dayStart,
		dayEnd: row.dayEnd,
		schemaVersion: row.schemaVersion,
		content: parseContent(row.contentJson),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		submittedAt: row.submittedAt,
	};
}

export function getEodEntryByDayStart(dayStart: number): EodEntry | null {
	if (!isDbOpen()) return null;
	const db = getDatabase();
	const row = db
		.prepare("SELECT * FROM eod_entries WHERE day_start = ? LIMIT 1")
		.get(dayStart) as RawRow | undefined;
	if (!row) return null;
	const parsed = transformRows<EodEntryDbRow>([row])[0];
	return parsed ? toEntry(parsed) : null;
}

export function listEodEntries(): EodEntry[] {
	if (!isDbOpen()) return [];
	const db = getDatabase();
	const rows = db
		.prepare("SELECT * FROM eod_entries ORDER BY day_start DESC")
		.all() as RawRow[];
	return transformRows<EodEntryDbRow>(rows).map(toEntry);
}

export function insertOrUpdateEodEntry(input: EodEntryInput): void {
	if (!isDbOpen()) return;
	const db = getDatabase();

	const existing = db
		.prepare(
			"SELECT id, created_at FROM eod_entries WHERE day_start = ? LIMIT 1",
		)
		.get(input.dayStart) as { id: string; created_at: number } | undefined;

	const contentJson = JSON.stringify(input.content);
	const submittedAt = input.submittedAt ?? null;

	if (existing) {
		db.prepare(
			`
        UPDATE eod_entries
        SET day_end = ?, schema_version = ?, content_json = ?, updated_at = ?, submitted_at = ?
        WHERE id = ?
      `,
		).run(
			input.dayEnd,
			input.schemaVersion,
			contentJson,
			input.updatedAt,
			submittedAt,
			existing.id,
		);
		return;
	}

	db.prepare(
		`
      INSERT INTO eod_entries (
        id,
        day_start,
        day_end,
        schema_version,
        content_json,
        created_at,
        updated_at,
        submitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
	).run(
		input.id,
		input.dayStart,
		input.dayEnd,
		input.schemaVersion,
		contentJson,
		input.createdAt,
		input.updatedAt,
		submittedAt,
	);
}
