import test from 'ava';
import type {Finding} from '../findings/types.js';
import {findingHash} from './hash.js';

console.log('\ndedup/hash.spec.ts');

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		rule: 'p/r',
		file: 'a.rs',
		lineRange: {start: 1, end: 5},
		category: 'security',
		severity: 'high',
		confidence: 'medium',
		offendingSnippet: 'x',
		...overrides,
	};
}

test('is a stable 16-char hex string', t => {
	const hash = findingHash(finding());
	t.regex(hash, /^[0-9a-f]{16}$/);
	t.is(findingHash(finding()), hash);
});

test('is identical for the same identity fields', t => {
	// Severity/confidence/snippet are not identity; nor is the line range, which
	// wobbles between LLM runs. Changing any of them keeps the hash stable.
	t.is(
		findingHash(finding()),
		findingHash(
			finding({
				severity: 'low',
				confidence: 'low',
				offendingSnippet: 'y',
				lineRange: {start: 99, end: 120},
			}),
		),
	);
});

test('changes when an identity field changes', t => {
	const base = findingHash(finding({pack: 'p'}));
	t.not(base, findingHash(finding({pack: 'p', file: 'b.rs'})));
	t.not(base, findingHash(finding({pack: 'other', file: 'a.rs'})));
});

test('survives the model renaming its own rule between runs', t => {
	// The regression. The prompt asks the model to invent the rule suffix, and
	// two runs over an identical file produced `sql/string-concat` and
	// `sql/string-concatenation`. Keying on that refiled the finding as a
	// duplicate AND aged the original towards being auto-resolved as fixed.
	t.is(
		findingHash(finding({pack: 'sql', rule: 'sql/string-concat'})),
		findingHash(finding({pack: 'sql', rule: 'sql/string-concatenation'})),
	);
});

test('survives the model relabelling the category', t => {
	t.is(
		findingHash(finding({pack: 'p', category: 'security'})),
		findingHash(finding({pack: 'p', category: 'performance'})),
	);
});

test('the pack comes from the stamp, not the rule prefix', t => {
	// A finding whose rule claims one pack but which was produced by another
	// is identified by the pack that actually ran. The rule prefix is the
	// model's transcription; the stamp is Sentinel's record.
	t.not(
		findingHash(finding({pack: 'real-pack', rule: 'claimed-pack/r'})),
		findingHash(finding({pack: 'claimed-pack', rule: 'claimed-pack/r'})),
	);
});

test('an unattributed finding still hashes, and differs from an attributed one', t => {
	// `pack` is optional: a caller that cannot attribute a finding still gets a
	// stable identity, and does not collide with a pack that can.
	t.regex(findingHash(finding()), /^[0-9a-f]{16}$/);
	t.not(findingHash(finding()), findingHash(finding({pack: 'p'})));
});
