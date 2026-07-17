/**
 * The findings validator. This is the hard gate the workflow runs against the
 * agent's structured output before anything is filed. It enforces three rules
 * (see docs/workflow/index.md#validation):
 *
 *   1. The output is well-formed JSON.
 *   2. Every finding's severity is within the allowed set.
 *   3. Every finding cites at least one file and a line range.
 *
 * On failure it returns a structured error report, which the auto-fix loop
 * feeds back to the agent for a second attempt.
 */

import {
	type Confidence,
	type Finding,
	isConfidence,
	isSeverity,
	type LineRange,
	type Severity,
} from './types.js';

/** A single reason a finding (or the whole output) failed validation. */
export interface ValidationError {
	/** Index of the offending finding, or -1 for a document-level error. */
	index: number;
	/** The field at fault, or 'document' for parse-level errors. */
	field: string;
	/** A human-readable explanation, suitable for the auto-fix prompt. */
	message: string;
}

/** The outcome of validating a batch of findings. */
export interface ValidationResult {
	valid: boolean;
	/** The findings that passed, in input order. */
	findings: Finding[];
	/** Every reason validation failed. Empty when valid. */
	errors: ValidationError[];
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function validateLineRange(
	value: unknown,
	index: number,
	errors: ValidationError[],
): value is LineRange {
	if (!isObject(value)) {
		errors.push({
			index,
			field: 'lineRange',
			message: 'lineRange must be an object with numeric start and end',
		});
		return false;
	}

	const {start, end} = value;
	if (typeof start !== 'number' || typeof end !== 'number') {
		errors.push({
			index,
			field: 'lineRange',
			message: 'lineRange.start and lineRange.end must both be numbers',
		});
		return false;
	}

	if (start < 1 || end < start) {
		errors.push({
			index,
			field: 'lineRange',
			message: 'lineRange must satisfy 1 <= start <= end',
		});
		return false;
	}

	return true;
}

function validateFinding(
	value: unknown,
	index: number,
	errors: ValidationError[],
): Finding | null {
	if (!isObject(value)) {
		errors.push({
			index,
			field: 'finding',
			message: 'finding must be an object',
		});
		return null;
	}

	const before = errors.length;

	if (!isNonEmptyString(value.rule)) {
		errors.push({
			index,
			field: 'rule',
			message: 'rule must be a non-empty string',
		});
	}

	// Rule 3: every finding cites at least one file...
	if (!isNonEmptyString(value.file)) {
		errors.push({
			index,
			field: 'file',
			message: 'file must be a non-empty string',
		});
	}

	// ...and a line range.
	validateLineRange(value.lineRange, index, errors);

	if (!isNonEmptyString(value.category)) {
		errors.push({
			index,
			field: 'category',
			message: 'category must be a non-empty string',
		});
	}

	// Rule 2: severity within the allowed set.
	if (!isSeverity(value.severity)) {
		errors.push({
			index,
			field: 'severity',
			message: 'severity must be one of: low, medium, high, critical',
		});
	}

	if (!isConfidence(value.confidence)) {
		errors.push({
			index,
			field: 'confidence',
			message: 'confidence must be one of: low, medium, high',
		});
	}

	if (!isNonEmptyString(value.offendingSnippet)) {
		errors.push({
			index,
			field: 'offendingSnippet',
			message: 'offendingSnippet must be a non-empty string',
		});
	}

	if (errors.length > before) {
		return null;
	}

	return {
		rule: value.rule as string,
		file: value.file as string,
		lineRange: value.lineRange as LineRange,
		category: value.category as string,
		severity: value.severity as Severity,
		confidence: value.confidence as Confidence,
		offendingSnippet: value.offendingSnippet as string,
	};
}

/**
 * Validate the agent's findings output. Accepts either a raw JSON string (which
 * it parses — Rule 1) or an already-parsed array of unknown values.
 */
export function validateFindings(raw: unknown): ValidationResult {
	const errors: ValidationError[] = [];
	let parsed: unknown = raw;

	// Rule 1: well-formed JSON.
	if (typeof raw === 'string') {
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				valid: false,
				findings: [],
				errors: [
					{index: -1, field: 'document', message: `invalid JSON: ${message}`},
				],
			};
		}
	}

	if (!Array.isArray(parsed)) {
		return {
			valid: false,
			findings: [],
			errors: [
				{
					index: -1,
					field: 'document',
					message: 'findings output must be an array',
				},
			],
		};
	}

	const findings: Finding[] = [];
	for (const [index, entry] of parsed.entries()) {
		const finding = validateFinding(entry, index, errors);
		if (finding) {
			findings.push(finding);
		}
	}

	return {valid: errors.length === 0, findings, errors};
}
