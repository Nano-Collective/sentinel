/**
 * Parse and validate a single rule pack file: split the YAML manifest header
 * from the Markdown body, validate the manifest against the v1 contract, and
 * normalise it to a {@link RulePack}. Failures come back as a structured
 * {@link ParseResult}, mirroring the findings validator.
 */

import {parse as parseYaml} from 'yaml';
import {isSeverity, type Severity} from '../findings/types.js';
import type {
	AppliesTo,
	ParseResult,
	RulePackError,
	RulePackManifest,
} from './types.js';

/** Kebab-case: lowercase alphanumerics separated by single hyphens. */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Semver core with an optional prerelease/build suffix. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * Split a pack file into its raw YAML manifest and Markdown body. Returns null
 * when the file does not open with a `---` fenced frontmatter block.
 */
export function splitFrontmatter(
	raw: string,
): {yaml: string; body: string} | null {
	const normalised = raw.replace(/\r\n/g, '\n');
	if (!normalised.startsWith('---\n')) {
		return null;
	}

	const rest = normalised.slice(4);
	const end = rest.indexOf('\n---');
	if (end === -1) {
		return null;
	}

	const yaml = rest.slice(0, end);
	// Drop the closing fence line (its trailing chars + newline), then any blank
	// lines separating the fence from the body.
	const afterFence = rest.slice(end + 4);
	const body = afterFence.replace(/^[^\n]*\n/, '').replace(/^\n+/, '');
	return {yaml, body};
}

function validateAppliesTo(value: unknown, errors: RulePackError[]): AppliesTo {
	const appliesTo: AppliesTo = {paths: [], languages: []};
	if (value === undefined) {
		return appliesTo;
	}

	if (!isObject(value)) {
		errors.push({
			field: 'applies_to',
			message: 'applies_to must be a mapping with optional paths and languages',
		});
		return appliesTo;
	}

	if (value.paths !== undefined) {
		if (isStringArray(value.paths)) {
			appliesTo.paths = value.paths;
		} else {
			errors.push({
				field: 'applies_to.paths',
				message: 'applies_to.paths must be a list of glob strings',
			});
		}
	}

	if (value.languages !== undefined) {
		if (isStringArray(value.languages)) {
			appliesTo.languages = value.languages;
		} else {
			errors.push({
				field: 'applies_to.languages',
				message: 'applies_to.languages must be a list of language identifiers',
			});
		}
	}

	return appliesTo;
}

function validateSeverityWeighting(
	value: unknown,
	errors: RulePackError[],
): Record<string, Severity> {
	const weighting: Record<string, Severity> = {};
	if (value === undefined) {
		return weighting;
	}

	if (!isObject(value)) {
		errors.push({
			field: 'severity_weighting',
			message:
				'severity_weighting must be a mapping of finding type to severity',
		});
		return weighting;
	}

	for (const [key, severity] of Object.entries(value)) {
		if (isSeverity(severity)) {
			weighting[key] = severity;
		} else {
			errors.push({
				field: `severity_weighting.${key}`,
				message: 'severity must be one of: low, medium, high, critical',
			});
		}
	}

	return weighting;
}

function validateDependsOn(
	value: unknown,
	name: unknown,
	errors: RulePackError[],
): string[] {
	if (value === undefined) {
		return [];
	}

	if (!isStringArray(value)) {
		errors.push({
			field: 'depends_on',
			message: 'depends_on must be a list of pack names',
		});
		return [];
	}

	if (typeof name === 'string' && value.includes(name)) {
		errors.push({
			field: 'depends_on',
			message: 'a pack cannot depend on itself',
		});
	}

	return value;
}

/**
 * Parse a rule pack file. On success, returns the normalised pack; on failure,
 * returns every reason it was rejected.
 */
export function parseRulePack(raw: string): ParseResult {
	const errors: RulePackError[] = [];

	const split = splitFrontmatter(raw);
	if (!split) {
		return {
			valid: false,
			pack: null,
			errors: [
				{
					field: 'document',
					message:
						'a rule pack must open with a --- fenced YAML manifest followed by a Markdown body',
				},
			],
		};
	}

	let manifestData: unknown;
	try {
		manifestData = parseYaml(split.yaml);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			pack: null,
			errors: [
				{field: 'document', message: `invalid YAML manifest: ${message}`},
			],
		};
	}

	if (!isObject(manifestData)) {
		return {
			valid: false,
			pack: null,
			errors: [{field: 'document', message: 'manifest must be a mapping'}],
		};
	}

	// name (required, kebab-case)
	if (!isNonEmptyString(manifestData.name)) {
		errors.push({
			field: 'name',
			message: 'name is required and must be a string',
		});
	} else if (!NAME_PATTERN.test(manifestData.name)) {
		errors.push({field: 'name', message: 'name must be kebab-case'});
	}

	// version (required, semver)
	if (!isNonEmptyString(manifestData.version)) {
		errors.push({
			field: 'version',
			message: 'version is required and must be a string',
		});
	} else if (!VERSION_PATTERN.test(manifestData.version)) {
		errors.push({
			field: 'version',
			message: 'version must be semver (e.g. 1.2.0)',
		});
	}

	// description (optional)
	if (
		manifestData.description !== undefined &&
		typeof manifestData.description !== 'string'
	) {
		errors.push({
			field: 'description',
			message: 'description must be a string',
		});
	}

	// category (optional)
	if (
		manifestData.category !== undefined &&
		!isNonEmptyString(manifestData.category)
	) {
		errors.push({
			field: 'category',
			message: 'category must be a non-empty string when present',
		});
	}

	const appliesTo = validateAppliesTo(manifestData.applies_to, errors);
	const severityWeighting = validateSeverityWeighting(
		manifestData.severity_weighting,
		errors,
	);
	const dependsOn = validateDependsOn(
		manifestData.depends_on,
		manifestData.name,
		errors,
	);

	// body (required — a pack with no prompt does nothing)
	if (split.body.trim().length === 0) {
		errors.push({
			field: 'body',
			message:
				'the Markdown body is empty; a pack must contain an audit prompt',
		});
	}

	if (errors.length > 0) {
		return {valid: false, pack: null, errors};
	}

	const manifest: RulePackManifest = {
		name: manifestData.name as string,
		version: manifestData.version as string,
		description:
			typeof manifestData.description === 'string'
				? manifestData.description
				: '',
		appliesTo,
		severityWeighting,
		dependsOn,
		category: isNonEmptyString(manifestData.category)
			? manifestData.category
			: '',
	};

	return {valid: true, pack: {manifest, body: split.body}, errors: []};
}
