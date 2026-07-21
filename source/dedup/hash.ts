/**
 * The content hash that identifies a finding across runs. Computed over the
 * salient fields (rule, file, line range, category) so the same finding on a
 * later run produces the same hash and is not filed twice
 * (see docs/findings/index.md#dedup).
 */

import {createHash} from 'node:crypto';
import type {Finding} from '../findings/types.js';

/** A stable 16-hex-char content hash for a finding. */
export function findingHash(finding: Finding): string {
	const salient = [
		finding.rule,
		finding.file,
		`${finding.lineRange.start}-${finding.lineRange.end}`,
		finding.category,
	].join('\n');
	return createHash('sha256').update(salient).digest('hex').slice(0, 16);
}
