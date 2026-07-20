import test from 'ava';
import {resolveDependencies} from './dependencies.js';
import type {RulePack} from './types.js';

console.log('\nrule-packs/dependencies.spec.ts');

function pack(name: string, dependsOn: string[] = []): RulePack {
	return {
		manifest: {
			name,
			version: '1.0.0',
			description: '',
			appliesTo: {paths: [], languages: []},
			severityWeighting: {},
			dependsOn,
			category: '',
		},
		body: 'audit',
	};
}

test('resolves a single pack with no dependencies', t => {
	const result = resolveDependencies([pack('solo')], 'solo');
	t.deepEqual(result.errors, []);
	t.deepEqual(result.order, ['solo']);
});

test('orders dependencies before their dependents', t => {
	const packs = [pack('solana-anchor', ['rust-general']), pack('rust-general')];
	const result = resolveDependencies(packs, 'solana-anchor');
	t.deepEqual(result.errors, []);
	t.deepEqual(result.order, ['rust-general', 'solana-anchor']);
});

test('resolves a transitive chain and includes the root last', t => {
	const packs = [pack('a', ['b']), pack('b', ['c']), pack('c')];
	const result = resolveDependencies(packs, 'a');
	t.deepEqual(result.order, ['c', 'b', 'a']);
});

test('deduplicates a diamond dependency', t => {
	const packs = [
		pack('top', ['left', 'right']),
		pack('left', ['base']),
		pack('right', ['base']),
		pack('base'),
	];
	const result = resolveDependencies(packs, 'top');
	t.deepEqual(result.errors, []);
	t.is(result.order.length, 4);
	t.is(result.order.at(-1), 'top');
	t.true(result.order.indexOf('base') < result.order.indexOf('left'));
	t.true(result.order.indexOf('base') < result.order.indexOf('right'));
});

test('reports a missing dependency', t => {
	const result = resolveDependencies([pack('a', ['ghost'])], 'a');
	t.true(result.errors.some(e => e.message.includes('ghost')));
	t.deepEqual(result.order, []);
});

test('reports an unknown root', t => {
	const result = resolveDependencies([pack('a')], 'missing');
	t.true(result.errors.some(e => e.message.includes('missing')));
});

test('detects a dependency cycle', t => {
	const packs = [pack('a', ['b']), pack('b', ['a'])];
	const result = resolveDependencies(packs, 'a');
	t.true(result.errors.some(e => e.message.includes('cycle')));
	t.deepEqual(result.order, []);
});
