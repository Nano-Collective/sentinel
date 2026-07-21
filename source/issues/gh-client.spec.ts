import test from 'ava';
import {
	buildGhCloseArgs,
	buildGhEditArgs,
	buildGhIssueArgs,
	buildGhLabelArgs,
	buildGhListArgs,
	parseIssueList,
	parseIssueUrl,
} from './gh-client.js';
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

test('buildGhListArgs requests all states and the dedup JSON fields', t => {
	const args = buildGhListArgs('my-org/x', 'sentinel');
	t.deepEqual(args, [
		'issue',
		'list',
		'--repo',
		'my-org/x',
		'--label',
		'sentinel',
		'--state',
		'all',
		'--limit',
		'1000',
		'--json',
		'number,url,state,labels,body',
	]);
});

test('buildGhEditArgs replaces the body of a numbered issue', t => {
	t.deepEqual(buildGhEditArgs('my-org/x', 42, 'new body'), [
		'issue',
		'edit',
		'42',
		'--repo',
		'my-org/x',
		'--body',
		'new body',
	]);
});

test('buildGhCloseArgs includes reason and comment when given', t => {
	t.deepEqual(buildGhCloseArgs('my-org/x', 42, 'completed', 'done'), [
		'issue',
		'close',
		'42',
		'--repo',
		'my-org/x',
		'--reason',
		'completed',
		'--comment',
		'done',
	]);
});

test('buildGhCloseArgs omits optional flags when absent', t => {
	t.deepEqual(buildGhCloseArgs('my-org/x', 42), [
		'issue',
		'close',
		'42',
		'--repo',
		'my-org/x',
	]);
});

test('parseIssueList maps gh json into ExistingIssues', t => {
	const json = JSON.stringify([
		{
			number: 5,
			url: 'https://github.com/my-org/x/issues/5',
			state: 'OPEN',
			labels: [{name: 'sentinel'}, {name: 'sentinel:wontfix'}],
			body: 'body text',
		},
	]);
	const issues = parseIssueList(json);
	t.is(issues.length, 1);
	t.is(issues[0]?.number, 5);
	t.is(issues[0]?.state, 'open');
	t.deepEqual(issues[0]?.labels, ['sentinel', 'sentinel:wontfix']);
});

test('buildGhLabelArgs creates the label idempotently', t => {
	const args = buildGhLabelArgs('my-org/x', 'sentinel');
	t.deepEqual(args.slice(0, 5), [
		'label',
		'create',
		'sentinel',
		'--repo',
		'my-org/x',
	]);
	t.true(args.includes('--force'));
});

test('parseIssueList normalises a closed state', t => {
	const json = JSON.stringify([
		{number: 1, url: 'u', state: 'CLOSED', labels: [], body: ''},
	]);
	t.is(parseIssueList(json)[0]?.state, 'closed');
});
