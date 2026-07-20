/**
 * The rule pack format. A pack is a single file: a YAML manifest header
 * followed by a Markdown body that is the audit prompt. The manifest is a
 * stable v1 contract (see docs/rule-packs/index.md#manifest-fields).
 *
 * Manifest keys are snake_case on disk (`applies_to`, `severity_weighting`,
 * `depends_on`) and normalised to camelCase here.
 */

import type {Severity} from '../findings/types.js';

/** Scopes which files within a repository a pack reads. */
export interface AppliesTo {
	/** Glob patterns for files the pack applies to. Empty = the whole repo. */
	paths: string[];
	/** Language identifiers the pack targets. A hint for scoping and reporting. */
	languages: string[];
}

/** The validated, normalised manifest of a rule pack. */
export interface RulePackManifest {
	/** Unique, kebab-case pack identifier. */
	name: string;
	/** Semver. Bumped whenever the audit body changes. */
	version: string;
	/** One-line description of what the pack audits for. */
	description: string;
	/** File scoping. */
	appliesTo: AppliesTo;
	/** Per-finding-type severity overrides, keyed by finding type. */
	severityWeighting: Record<string, Severity>;
	/** Other packs that should run alongside this one, by name. */
	dependsOn: string[];
	/** The pack's primary category, carried onto findings. */
	category: string;
}

/** A parsed rule pack: its manifest and the Markdown audit prompt. */
export interface RulePack {
	manifest: RulePackManifest;
	/** The Markdown body handed to the model as the audit prompt. */
	body: string;
}

/** A single reason a pack (or a manifest field) failed to parse or validate. */
export interface RulePackError {
	/** The offending manifest field, or 'document' for structural errors. */
	field: string;
	/** A human-readable explanation. */
	message: string;
}

/** The outcome of parsing a single rule pack file. */
export interface ParseResult {
	valid: boolean;
	/** The parsed pack, or null when validation failed. */
	pack: RulePack | null;
	/** Every reason parsing failed. Empty when valid. */
	errors: RulePackError[];
}
