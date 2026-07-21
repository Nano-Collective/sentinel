import test from 'ava';
import type {Target} from '../config/types.js';
import {expandTargets} from './expand.js';
import type {RepoLister} from './repo-lister.js';

console.log('\nrun/expand.spec.ts');

function lister(
	byOwner: Record<string, string[]>,
): RepoLister & {calls: string[]} {
	return {
		calls: [],
		async list(owner: string): Promise<string[]> {
			this.calls.push(owner);
			return byOwner[owner] ?? [];
		},
	};
}

test('passes explicit repo targets through', async t => {
	const targets: Target[] = [{repo: 'my-org/a', rulePacks: ['p']}];
	const result = await expandTargets(targets);
	t.deepEqual(result.targets, [{repo: 'my-org/a', rulePacks: ['p']}]);
	t.deepEqual(result.errors, []);
});

test('expands a pattern against the owner repos', async t => {
	const targets: Target[] = [{pattern: 'my-org/web-*', rulePacks: ['web']}];
	const l = lister({
		'my-org': ['my-org/web-app', 'my-org/web-admin', 'my-org/api'],
	});
	const result = await expandTargets(targets, l);
	t.deepEqual(result.targets.map(target => target.repo).sort(), [
		'my-org/web-admin',
		'my-org/web-app',
	]);
	t.deepEqual(result.targets[0]?.rulePacks, ['web']);
});

test('merges rule packs when a repo matches several targets', async t => {
	const targets: Target[] = [
		{repo: 'my-org/api', rulePacks: ['node']},
		{pattern: 'my-org/*', rulePacks: ['org-conventions']},
	];
	const l = lister({'my-org': ['my-org/api', 'my-org/web']});
	const result = await expandTargets(targets, l);
	const api = result.targets.find(target => target.repo === 'my-org/api');
	t.deepEqual(api?.rulePacks.sort(), ['node', 'org-conventions']);
	// The org pattern also pulled in web.
	t.true(result.targets.some(target => target.repo === 'my-org/web'));
});

test('lists each owner only once across patterns', async t => {
	const targets: Target[] = [
		{pattern: 'my-org/a-*', rulePacks: ['x']},
		{pattern: 'my-org/b-*', rulePacks: ['y']},
	];
	const l = lister({'my-org': ['my-org/a-1', 'my-org/b-1']});
	await expandTargets(targets, l);
	t.deepEqual(l.calls, ['my-org']);
});

test('records an error for a pattern with no lister', async t => {
	const targets: Target[] = [{pattern: 'my-org/*', rulePacks: ['p']}];
	const result = await expandTargets(targets);
	t.is(result.targets.length, 0);
	t.is(result.errors.length, 1);
	t.true(result.errors[0]?.includes('my-org/*'));
});

test('records an error when listing fails', async t => {
	const failing: RepoLister = {
		async list(): Promise<string[]> {
			throw new Error('gh auth expired');
		},
	};
	const result = await expandTargets(
		[{pattern: 'my-org/*', rulePacks: ['p']}],
		failing,
	);
	t.is(result.targets.length, 0);
	t.true(result.errors[0]?.includes('gh auth expired'));
});
