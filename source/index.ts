/**
 * Public library API for @nanocollective/sentinel.
 *
 * The same package is both the scaffolder (`sentinel init`), the workflow
 * runtime (`sentinel run`), and a library. This module is the library surface.
 */

export type {
	Confidence,
	Finding,
	LineRange,
	Severity,
} from './findings/types.js';
export {
	CONFIDENCES,
	isConfidence,
	isSeverity,
	SEVERITIES,
} from './findings/types.js';
export type {
	ValidationError,
	ValidationResult,
} from './findings/validate.js';
export {validateFindings} from './findings/validate.js';
