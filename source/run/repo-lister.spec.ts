import test from 'ava';
import {buildRepoListArgs, parseRepoList} from './repo-lister.js';

console.log('\nrun/repo-lister.spec.ts');

test('buildRepoListArgs requests the json fields for expansion', t => {
	t.deepEqual(buildRepoListArgs('my-org'), [
		'repo',
		'list',
		'my-org',
		'--limit',
		'1000',
		'--json',
		'nameWithOwner,isArchived',
	]);
});

test('parseRepoList returns nameWithOwner for non-archived repos', t => {
	const json = JSON.stringify([
		{nameWithOwner: 'my-org/a', isArchived: false},
		{nameWithOwner: 'my-org/legacy', isArchived: true},
		{nameWithOwner: 'my-org/b', isArchived: false},
	]);
	t.deepEqual(parseRepoList(json), ['my-org/a', 'my-org/b']);
});

test('parseRepoList handles an empty list', t => {
	t.deepEqual(parseRepoList('[]'), []);
});
