/**
 * Parse and validate `sentinel.yaml`. Applies sensible defaults (schedule,
 * severity threshold, issue routing), enforces the target and model contracts,
 * and returns a structured {@link ConfigResult} — the same error shape used by
 * the findings validator and the rule pack parser.
 */

import {parse as parseYaml} from 'yaml';
import {isSeverity, type Severity} from '../findings/types.js';
import type {
	ConfigError,
	ConfigResult,
	IssuesConfig,
	ModelConfig,
	SentinelConfig,
	Target,
} from './types.js';

const DEFAULT_SCHEDULE = '0 6 * * *';
const DEFAULT_SEVERITY_THRESHOLD: Severity = 'medium';
const DEFAULT_LABEL = 'sentinel';

/** `owner/name`, with no whitespace or extra slashes. */
const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

/** Kebab-case rule pack name. */
const PACK_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A single cron field: digits, and the `* , - /` operators. */
const CRON_FIELD_PATTERN = /^[\d*,/-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

/** Light cron validation: five fields, each using only cron characters. */
function isValidCron(value: string): boolean {
	const fields = value.trim().split(/\s+/);
	if (fields.length !== 5) {
		return false;
	}
	return fields.every(field => CRON_FIELD_PATTERN.test(field));
}

function validateTarget(
	value: unknown,
	index: number,
	errors: ConfigError[],
): Target | null {
	const field = `targets[${index}]`;
	if (!isObject(value)) {
		errors.push({field, message: 'each target must be a mapping'});
		return null;
	}

	const hasRepo = value.repo !== undefined;
	const hasPattern = value.pattern !== undefined;
	if (hasRepo === hasPattern) {
		errors.push({
			field,
			message: 'each target must set exactly one of repo or pattern',
		});
	}

	if (
		hasRepo &&
		!(isNonEmptyString(value.repo) && REPO_PATTERN.test(value.repo))
	) {
		errors.push({
			field: `${field}.repo`,
			message: 'repo must be in owner/name form',
		});
	}

	if (hasPattern && !isNonEmptyString(value.pattern)) {
		errors.push({
			field: `${field}.pattern`,
			message: 'pattern must be a non-empty string',
		});
	}

	const rulePacks: string[] = [];
	if (!Array.isArray(value.rule_packs) || value.rule_packs.length === 0) {
		errors.push({
			field: `${field}.rule_packs`,
			message: 'rule_packs must be a non-empty list of pack names',
		});
	} else {
		for (const [i, name] of value.rule_packs.entries()) {
			if (typeof name === 'string' && PACK_NAME_PATTERN.test(name)) {
				rulePacks.push(name);
			} else {
				errors.push({
					field: `${field}.rule_packs[${i}]`,
					message: 'each rule pack name must be kebab-case',
				});
			}
		}
	}

	const target: Target = {rulePacks};
	if (hasRepo && typeof value.repo === 'string') {
		target.repo = value.repo;
	}
	if (hasPattern && typeof value.pattern === 'string') {
		target.pattern = value.pattern;
	}
	return target;
}

function validateModel(
	value: unknown,
	errors: ConfigError[],
): ModelConfig | null {
	if (!isObject(value)) {
		errors.push({
			field: 'model',
			message: 'model is required and must be a mapping',
		});
		return null;
	}

	if (!isNonEmptyString(value.provider)) {
		errors.push({
			field: 'model.provider',
			message: 'model.provider is required',
		});
	}
	if (!isNonEmptyString(value.model)) {
		errors.push({field: 'model.model', message: 'model.model is required'});
	}

	const model: ModelConfig = {
		provider: isNonEmptyString(value.provider) ? value.provider : '',
		model: isNonEmptyString(value.model) ? value.model : '',
	};

	if (value.fallback !== undefined) {
		if (!isObject(value.fallback)) {
			errors.push({
				field: 'model.fallback',
				message: 'model.fallback must be a mapping',
			});
		} else {
			const fb = value.fallback;
			if (!isNonEmptyString(fb.provider) || !isNonEmptyString(fb.model)) {
				errors.push({
					field: 'model.fallback',
					message: 'model.fallback requires provider and model',
				});
			} else {
				model.fallback = {provider: fb.provider, model: fb.model};
				if (fb.endpoint_secret !== undefined) {
					if (isNonEmptyString(fb.endpoint_secret)) {
						model.fallback.endpointSecret = fb.endpoint_secret;
					} else {
						errors.push({
							field: 'model.fallback.endpoint_secret',
							message: 'endpoint_secret must be a non-empty string',
						});
					}
				}
			}
		}
	}

	return model;
}

function validateIssues(value: unknown, errors: ConfigError[]): IssuesConfig {
	const issues: IssuesConfig = {
		label: DEFAULT_LABEL,
		assignee: null,
		aggregateToConfigRepo: false,
	};
	if (value === undefined) {
		return issues;
	}

	if (!isObject(value)) {
		errors.push({field: 'issues', message: 'issues must be a mapping'});
		return issues;
	}

	if (value.label !== undefined) {
		if (isNonEmptyString(value.label)) {
			issues.label = value.label;
		} else {
			errors.push({
				field: 'issues.label',
				message: 'label must be a non-empty string',
			});
		}
	}

	if (value.assignee !== undefined && value.assignee !== null) {
		if (isNonEmptyString(value.assignee)) {
			issues.assignee = value.assignee;
		} else {
			errors.push({
				field: 'issues.assignee',
				message: 'assignee must be a GitHub login or null',
			});
		}
	}

	if (value.aggregate_to_config_repo !== undefined) {
		if (typeof value.aggregate_to_config_repo === 'boolean') {
			issues.aggregateToConfigRepo = value.aggregate_to_config_repo;
		} else {
			errors.push({
				field: 'issues.aggregate_to_config_repo',
				message: 'aggregate_to_config_repo must be a boolean',
			});
		}
	}

	return issues;
}

/**
 * Parse `sentinel.yaml`. On success, returns the normalised config with
 * defaults applied; on failure, returns every reason it was rejected.
 */
export function parseConfig(raw: string): ConfigResult {
	let data: unknown;
	try {
		data = parseYaml(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			valid: false,
			config: null,
			errors: [{field: 'document', message: `invalid YAML: ${message}`}],
		};
	}

	if (!isObject(data)) {
		return {
			valid: false,
			config: null,
			errors: [{field: 'document', message: 'sentinel.yaml must be a mapping'}],
		};
	}

	const errors: ConfigError[] = [];

	// targets (required, non-empty)
	const targets: Target[] = [];
	if (!Array.isArray(data.targets) || data.targets.length === 0) {
		errors.push({
			field: 'targets',
			message: 'targets is required and must list at least one repository',
		});
	} else {
		for (const [index, entry] of data.targets.entries()) {
			const target = validateTarget(entry, index, errors);
			if (target) {
				targets.push(target);
			}
		}
	}

	// schedule (optional, defaulted)
	let schedule = DEFAULT_SCHEDULE;
	if (data.schedule !== undefined) {
		if (isNonEmptyString(data.schedule) && isValidCron(data.schedule)) {
			schedule = data.schedule.trim();
		} else {
			errors.push({
				field: 'schedule',
				message: 'schedule must be a 5-field cron expression',
			});
		}
	}

	// severity_threshold (optional, defaulted)
	let severityThreshold = DEFAULT_SEVERITY_THRESHOLD;
	if (data.severity_threshold !== undefined) {
		if (isSeverity(data.severity_threshold)) {
			severityThreshold = data.severity_threshold;
		} else {
			errors.push({
				field: 'severity_threshold',
				message:
					'severity_threshold must be one of: low, medium, high, critical',
			});
		}
	}

	const model = validateModel(data.model, errors);
	const issues = validateIssues(data.issues, errors);

	if (errors.length > 0 || !model) {
		return {valid: false, config: null, errors};
	}

	const config: SentinelConfig = {
		targets,
		schedule,
		severityThreshold,
		model,
		issues,
	};
	return {valid: true, config, errors: []};
}
