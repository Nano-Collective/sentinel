import test from 'ava';
import {lookup, parseCache, record, serialiseCache} from './cache.js';
import {CACHE_VERSION, emptyCache, type PackCacheEntry} from './types.js';

console.log('\nincremental/cache.spec.ts');

function entry(overrides: Partial<PackCacheEntry> = {}): PackCacheEntry {
	return {
		pack: 'db-safety',
		packVersion: '1.0.0',
		bodyHash: 'aaaa',
		dependencyHash: 'bbbb',
		sha: 'sha-1',
		...overrides,
	};
}

test('a missing cache file is an empty cache', t => {
	t.deepEqual(parseCache(null), emptyCache());
});

test('malformed JSON is an empty cache, not a crash', t => {
	// An unreadable cache must degrade to reading everything. Throwing here would
	// take down a scheduled audit over a file whose only job is to make it faster.
	t.deepEqual(parseCache('{not json'), emptyCache());
});

test('a cache from an unknown schema version is discarded', t => {
	// The safe direction: a shape whose meaning may have changed is not trusted,
	// so the run reads everything and rebuilds it.
	t.deepEqual(
		parseCache(JSON.stringify({version: CACHE_VERSION + 1, repos: []})),
		emptyCache(),
	);
});

test('a cache with no repos array is discarded', t => {
	t.deepEqual(
		parseCache(JSON.stringify({version: CACHE_VERSION})),
		emptyCache(),
	);
});

test('a well-formed cache round-trips', t => {
	const cache = record(emptyCache(), 'org/a', entry());
	t.deepEqual(parseCache(serialiseCache(cache)), cache);
});

test('lookup finds an entry by repo and pack', t => {
	const cache = record(emptyCache(), 'org/a', entry());
	t.is(lookup(cache, 'org/a', 'db-safety')?.sha, 'sha-1');
});

test('lookup does not cross repositories', t => {
	const cache = record(emptyCache(), 'org/a', entry());
	t.is(lookup(cache, 'org/b', 'db-safety'), undefined);
});

test('lookup does not cross packs', t => {
	const cache = record(emptyCache(), 'org/a', entry());
	t.is(lookup(cache, 'org/a', 'other-pack'), undefined);
});

test('recording the same pack twice replaces rather than duplicates', t => {
	let cache = record(emptyCache(), 'org/a', entry({sha: 'sha-1'}));
	cache = record(cache, 'org/a', entry({sha: 'sha-2'}));
	t.is(cache.repos[0]?.packs.length, 1);
	t.is(lookup(cache, 'org/a', 'db-safety')?.sha, 'sha-2');
});

test('recording a second pack keeps the first', t => {
	let cache = record(emptyCache(), 'org/a', entry());
	cache = record(cache, 'org/a', entry({pack: 'other', sha: 'sha-2'}));
	t.is(cache.repos[0]?.packs.length, 2);
	t.is(lookup(cache, 'org/a', 'db-safety')?.sha, 'sha-1');
});

test('recording a second repo keeps the first', t => {
	let cache = record(emptyCache(), 'org/a', entry());
	cache = record(cache, 'org/b', entry({sha: 'sha-2'}));
	t.is(cache.repos.length, 2);
	t.is(lookup(cache, 'org/a', 'db-safety')?.sha, 'sha-1');
	t.is(lookup(cache, 'org/b', 'db-safety')?.sha, 'sha-2');
});

test('record does not mutate the cache it was given', t => {
	const before = record(emptyCache(), 'org/a', entry({sha: 'sha-1'}));
	const snapshot = structuredClone(before);
	record(before, 'org/a', entry({sha: 'sha-2'}));
	t.deepEqual(before, snapshot);
});

test('serialised output ends with a newline', t => {
	t.true(serialiseCache(emptyCache()).endsWith('\n'));
});
