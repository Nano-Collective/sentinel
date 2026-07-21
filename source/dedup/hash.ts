/**
 * The content hash that identifies a finding across runs. Computed over the
 * fields that stay stable when the same finding is re-audited: rule, file, and
 * category. The line range is deliberately excluded — LLMs report slightly
 * different spans for the same issue between runs, so including it would break
 * dedup and refile duplicates. The trade-off is that two distinct findings of
 * the same rule in the same file collapse to one issue, which is the cleaner
 * outcome for a maintainer anyway (see docs/findings/index.md#dedup).
 */

import {createHash} from 'node:crypto';
import type {Finding} from '../findings/types.js';

/** A stable 16-hex-char content hash for a finding. */
export function findingHash(finding: Finding): string {
	const salient = [finding.rule, finding.file, finding.category].join('\n');
	return createHash('sha256').update(salient).digest('hex').slice(0, 16);
}
