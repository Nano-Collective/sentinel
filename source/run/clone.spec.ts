import test from 'ava';
import {buildCloneArgs} from './clone.js';

console.log('\nrun/clone.spec.ts');

test('builds a shallow single-branch gh clone argv', t => {
	t.deepEqual(buildCloneArgs('my-org/prog', '/ws/my-org/prog'), [
		'repo',
		'clone',
		'my-org/prog',
		'/ws/my-org/prog',
		'--',
		'--depth',
		'1',
		'--single-branch',
	]);
});
