/**
 * Parse the opt-in `sentinel.yaml` placed in an audited repo — the most
 * specific suppression layer (see docs/findings/index.md#suppression). It can
 * override the org severity threshold for this repo and declare systematic-
 * noise exemptions.
 */

import {parse as parseYaml} from 'yaml';
import {isSeverity} from '../findings/types.js';
import type {
	ConfigError,
	RepoOverride,
	RepoOverrideResult,
	Suppression,
} from './types.js';

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function validateSuppression(
	value: unknown,
	index: number,
	errors: ConfigError[],
): Suppression | null {
	const field = `suppress[${index}]`;
	if (!isObject(value)) {
		errors.push({field, message: 'each suppression must be a mapping'});
		return null;
	}

	const hasRule = value.rule !== undefined;
	const hasPaths = value.paths !== undefined;
	if (!hasRule && !hasPaths) {
		errors.push({
			field,
			message: 'a suppression must set at least one of rule or paths',
		});
	}

	if (hasRule && !isNonEmptyString(value.rule)) {
		errors.push({
			field: `${field}.rule`,
			message: 'rule must be a non-empty string',
		});
	}

	let paths: string[] = [];
	if (hasPaths) {
		if (isStringArray(value.paths) && value.paths.length > 0) {
			paths = value.paths;
		} else {
			errors.push({
				field: `${field}.paths`,
				message: 'paths must be a non-empty list of glob strings',
			});
		}
	}

	if (value.reason !== undefined && typeof value.reason !== 'string') {
		errors.push({field: `${field}.reason`, message: 'reason must be a string'});
	}

	if (errors.some(e => e.field.startsWith(field))) {
		return null;
	}

	const suppression: Suppression = {
		paths,
		reason: typeof value.reason === 'string' ? value.reason : '',
	};
	if (isNonEmptyString(value.rule)) {
		suppression.rule = value.rule;
	}
	return suppression;
}

/**
 * Parse a per-repo override. An empty or absent file is valid and yields an
 * override with no threshold change and no suppressions.
 */
export function parseRepoOverride(raw: string): RepoOverrideResult {
	let data: unknown;
	try {
		data = raw.trim().length === 0 ? {} : parseYaml(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			override: null,
			errors: [{field: 'document', message: `invalid YAML: ${message}`}],
		};
	}

	if (data === null) {
		return {valid: true, override: {suppress: []}, errors: []};
	}

	if (!isObject(data)) {
		return {
			valid: false,
			override: null,
			errors: [
				{
					field: 'document',
					message: 'per-repo sentinel.yaml must be a mapping',
				},
			],
		};
	}

	const errors: ConfigError[] = [];
	const override: RepoOverride = {suppress: []};

	if (data.severity_threshold !== undefined) {
		if (isSeverity(data.severity_threshold)) {
			override.severityThreshold = data.severity_threshold;
		} else {
			errors.push({
				field: 'severity_threshold',
				message:
					'severity_threshold must be one of: low, medium, high, critical',
			});
		}
	}

	if (data.suppress !== undefined) {
		if (!Array.isArray(data.suppress)) {
			errors.push({field: 'suppress', message: 'suppress must be a list'});
		} else {
			for (const [index, entry] of data.suppress.entries()) {
				const suppression = validateSuppression(entry, index, errors);
				if (suppression) {
					override.suppress.push(suppression);
				}
			}
		}
	}

	if (errors.length > 0) {
		return {valid: false, override: null, errors};
	}

	return {valid: true, override, errors: []};
}
