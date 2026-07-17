/**
 * The findings data model. This is a stable contract: rich enough that a
 * future auto-fix surface can consume it without a migration, even though v1
 * only files issues. See docs/findings/index.md.
 */

/** The four-tier severity scale. Order matters: index encodes rank. */
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Confidence is tracked separately from severity. */
export const CONFIDENCES = ['low', 'medium', 'high'] as const;

export type Confidence = (typeof CONFIDENCES)[number];

/** A 1-indexed, inclusive line range within a file. */
export interface LineRange {
	start: number;
	end: number;
}

/** A single thing a rule pack flagged. */
export interface Finding {
	/** The rule pack (and pattern within it) that produced the finding. */
	rule: string;
	/** The affected file, relative to the repository root. */
	file: string;
	/** The line range within that file. */
	lineRange: LineRange;
	/** The finding's category, carried from the pack. */
	category: string;
	/** One of the four severities. */
	severity: Severity;
	/** The model's confidence in the finding. */
	confidence: Confidence;
	/** The relevant code excerpt. */
	offendingSnippet: string;
}

/** Returns true if the value is one of the allowed severities. */
export function isSeverity(value: unknown): value is Severity {
	return (
		typeof value === 'string' &&
		(SEVERITIES as readonly string[]).includes(value)
	);
}

/** Returns true if the value is one of the allowed confidences. */
export function isConfidence(value: unknown): value is Confidence {
	return (
		typeof value === 'string' &&
		(CONFIDENCES as readonly string[]).includes(value)
	);
}
