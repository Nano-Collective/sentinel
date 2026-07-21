import test from 'ava';
import {buildGhIssueArgs, parseIssueUrl} from './gh-client.js';
import type {CreateIssueParams} from './types.js';

console.log('\nissues/gh-client.spec.ts');

const PARAMS: CreateIssueParams = {
	repo: 'my-org/my-program',
	title: 'Sentinel [high] finding',
	body: 'the body',
	labels: ['sentinel', 'security'],
	assignees: ['octocat'],
};

test('buildGhIssueArgs assembles the gh issue create argv', t => {
	t.deepEqual(buildGhIssueArgs(PARAMS), [
		'issue',
		'create',
		'--repo',
		'my-org/my-program',
		'--title',
		'Sentinel [high] finding',
		'--body',
		'the body',
		'--label',
		'sentinel',
		'--label',
		'security',
		'--assignee',
		'octocat',
	]);
});

test('buildGhIssueArgs omits labels and assignees when empty', t => {
	const args = buildGhIssueArgs({...PARAMS, labels: [], assignees: []});
	t.false(args.includes('--label'));
	t.false(args.includes('--assignee'));
});

test('parseIssueUrl extracts the number and url from gh output', t => {
	const out = 'https://github.com/my-org/my-program/issues/123\n';
	t.deepEqual(parseIssueUrl(out), {
		number: 123,
		url: 'https://github.com/my-org/my-program/issues/123',
	});
});

test('parseIssueUrl reads the last line of noisier output', t => {
	const out =
		'Creating issue in my-org/my-program\nhttps://github.com/my-org/my-program/issues/7';
	t.is(parseIssueUrl(out)?.number, 7);
});

test('parseIssueUrl returns null when there is no issue url', t => {
	t.is(parseIssueUrl('something went wrong'), null);
});
