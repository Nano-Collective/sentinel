import test from 'ava';
import type {RulePack} from '../rule-packs/types.js';
import {lookup} from './cache.js';
import {dependencyHash, type GitProbe, packBodyHash} from './decide.js';
import {CacheSession} from './session.js';
import {emptyCache} from './types.js';

console.log('\nincremental/session.spec.ts');

function pack(name = 'db-safety', body = 'audit'): RulePack {
	return {
		manifest: {
			name,
			version: '1.2.0',
			description: '',
			appliesTo: {paths: ['**/*.ts'], languages: []},
			severityWeighting: {},
			dependsOn: [],
			category: 'security',
		},
		body,
	};
}

function probe(head: string | null): GitProbe {
	return {head: () => head, changedSince: () => []};
}

test('a completed pass records the pack, its hashes and the commit', t => {
	const session = new CacheSession(emptyCache(), probe('sha-now'));
	session.recordPass('org/a', '/ws/a', pack(), []);

	const entry = lookup(session.result(), 'org/a', 'db-safety');
	t.is(entry?.sha, 'sha-now');
	t.is(entry?.packVersion, '1.2.0');
	t.is(entry?.bodyHash, packBodyHash(pack()));
	t.is(entry?.dependencyHash, dependencyHash([]));
});

test('a repository whose HEAD cannot be read records nothing', t => {
	// With no commit there is nothing a later run could diff against. Inventing
	// one would licence skipping files on a boundary that means nothing.
	const session = new CacheSession(emptyCache(), probe(null));
	session.recordPass('org/a', '/ws/a', pack(), []);
	t.deepEqual(session.result(), emptyCache());
});

test('the cache read at the start is not disturbed by recording', t => {
	// Decisions for later packs in the same run must be made against the state
	// the run began with, not against what this run has already written.
	const session = new CacheSession(emptyCache(), probe('sha-now'));
	session.recordPass('org/a', '/ws/a', pack(), []);
	t.is(session.entryFor('org/a', 'db-safety'), undefined);
	t.not(lookup(session.result(), 'org/a', 'db-safety'), undefined);
});

test('dependencies are hashed into the entry', t => {
	const dependency = pack('ts-general', 'shared body');
	const session = new CacheSession(emptyCache(), probe('sha-now'));
	session.recordPass('org/a', '/ws/a', pack(), [dependency]);
	t.is(
		lookup(session.result(), 'org/a', 'db-safety')?.dependencyHash,
		dependencyHash([dependency]),
	);
});

test('entryFor reads the cache the session was constructed with', t => {
	const existing = {
		version: 1,
		repos: [
			{
				repo: 'org/a',
				packs: [
					{
						pack: 'db-safety',
						packVersion: '1.0.0',
						bodyHash: 'h',
						dependencyHash: 'd',
						sha: 'sha-old',
					},
				],
			},
		],
	};
	const session = new CacheSession(existing, probe('sha-now'));
	t.is(session.entryFor('org/a', 'db-safety')?.sha, 'sha-old');
});
