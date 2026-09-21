/**
 * The content hash that identifies a finding across runs.
 *
 * Computed over the **pack** and the **file**, and nothing else. The
 * constraint is not "which fields describe the finding best" — it is "which
 * fields are the same on the next run", and a model-authored field is not one
 * of them.
 *
 * `line_range` was already excluded for that reason: models report slightly
 * different spans for the same issue. `rule` and `category` were not, and both
 * are prose the model writes — the prompt literally asks it to invent the rule
 * suffix (`"<pack>/<pattern>"`). Two runs over an identical file produced
 * `sql/string-concat` and `sql/string-concatenation`, which hashed differently,
 * so the finding was refiled as a duplicate *and* the original was aged a miss
 * towards being auto-resolved as fixed. On a daily schedule that is a fresh
 * duplicate every morning and a real vulnerability closed within the week.
 *
 * `pack` is stamped by Sentinel after validation, never read from the model —
 * the same distinction `withScopeMarkers` draws when it takes the pack from the
 * filing context rather than the rule prefix. `file` is model-authored but
 * concrete: it names something that exists, and it is what the operator would
 * use to find the issue again.
 *
 * The cost is that two distinct findings from one pack in one file collapse
 * into a single issue. `docs/findings/index.md#dedup` already argues that is
 * the better outcome for a maintainer, and it is much the better failure than
 * the one above.
 */

import {createHash} from 'node:crypto';
import type {Finding} from '../findings/types.js';

/** The fields a finding is identified by. */
export interface FindingIdentity {
	/** The pack that ran, as Sentinel knows it. */
	pack?: string;
	/** The affected file, repository-relative. */
	file: string;
}

/** A stable 16-hex-char content hash for a finding. */
export function findingHash(finding: Finding | FindingIdentity): string {
	const salient = [finding.pack ?? '', finding.file].join('\n');
	return createHash('sha256').update(salient).digest('hex').slice(0, 16);
}
