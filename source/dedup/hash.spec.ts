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
	const base = findingHash(finding());
	t.not(base, findingHash(finding({rule: 'p/other'})));
	t.not(base, findingHash(finding({file: 'b.rs'})));
	t.not(base, findingHash(finding({category: 'performance'})));
});
