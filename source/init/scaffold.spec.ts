import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {scaffold} from './scaffold.js';
import {DEFAULT_INIT_OPTIONS, type InitOptions} from './types.js';

console.log('\ninit/scaffold.spec.ts');

let counter = 0;
function freshDir(): string {
	counter++;
	const dir = join(tmpdir(), `sentinel-init-${process.pid}-${counter}`);
	mkdirSync(dir, {recursive: true});
	return dir;
}

const OPTIONS: InitOptions = {...DEFAULT_INIT_OPTIONS, targets: ['my-org/a']};

test('writes the full file set into an empty directory', t => {
	const dir = freshDir();
	try {
		const result = scaffold(OPTIONS, dir);
		t.deepEqual(result.written, [
			'sentinel.yaml',
			'agents.config.json',
			'.github/workflows/sentinel.yml',
			'rule-packs/_starter/example.md',
			'README.md',
		]);
		t.deepEqual(result.skipped, []);
		t.true(existsSync(join(dir, 'sentinel.yaml')));
		t.true(existsSync(join(dir, '.github/workflows/sentinel.yml')));
		t.true(existsSync(join(dir, 'rule-packs/_starter/example.md')));
		t.true(existsSync(join(dir, 'README.md')));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('the scaffolded config reflects the options', t => {
	const dir = freshDir();
	try {
		scaffold(OPTIONS, dir);
		const yaml = readFileSync(join(dir, 'sentinel.yaml'), 'utf8');
		t.true(yaml.includes('my-org/a'));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('skips existing files instead of clobbering them', t => {
	const dir = freshDir();
	try {
		writeFileSync(join(dir, 'sentinel.yaml'), 'DO NOT OVERWRITE');
		const result = scaffold(OPTIONS, dir);
		t.true(result.skipped.includes('sentinel.yaml'));
		t.false(result.written.includes('sentinel.yaml'));
		t.is(readFileSync(join(dir, 'sentinel.yaml'), 'utf8'), 'DO NOT OVERWRITE');
		// Other files were still written.
		t.true(result.written.includes('README.md'));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('force overwrites existing files', t => {
	const dir = freshDir();
	try {
		writeFileSync(join(dir, 'sentinel.yaml'), 'old');
		const result = scaffold(OPTIONS, dir, true);
		t.true(result.written.includes('sentinel.yaml'));
		t.not(readFileSync(join(dir, 'sentinel.yaml'), 'utf8'), 'old');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('the scaffolded workflow commits the incremental cache', t => {
	// Without this the cache is written and thrown away on the next checkout, so
	// every scheduled run finds no cache and re-reads everything — incremental
	// scanning would look enabled and quietly do nothing.
	const dir = freshDir();
	try {
		scaffold(OPTIONS, dir);
		const workflow = readFileSync(
			join(dir, '.github/workflows/sentinel.yml'),
			'utf8',
		);
		t.true(workflow.includes('.sentinel-cache.json'));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
