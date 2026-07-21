import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {fsPackLoader, fsRepoFiles} from './sources.js';

console.log('\nrun/sources.spec.ts');

let counter = 0;
function freshDir(): string {
	counter++;
	const dir = join(tmpdir(), `sentinel-src-${process.pid}-${counter}`);
	mkdirSync(dir, {recursive: true});
	return dir;
}

function write(dir: string, relativePath: string, content: string): void {
	const full = join(dir, relativePath);
	mkdirSync(join(full, '..'), {recursive: true});
	writeFileSync(full, content);
}

test('fsRepoFiles reads files matching the patterns and skips noise dirs', async t => {
	const dir = freshDir();
	try {
		write(dir, 'src/a.ts', 'a');
		write(dir, 'src/nested/b.ts', 'b');
		write(dir, 'docs/readme.md', 'ignore me');
		write(dir, 'node_modules/pkg/index.ts', 'skip');
		const files = await fsRepoFiles.read(dir, ['src/**/*.ts']);
		t.deepEqual(
			files.map(f => f.path),
			['src/a.ts', 'src/nested/b.ts'],
		);
		t.is(files[0]?.content, 'a');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('fsRepoFiles with no patterns reads the whole repo', async t => {
	const dir = freshDir();
	try {
		write(dir, 'a.txt', '1');
		write(dir, 'sub/b.txt', '2');
		const files = await fsRepoFiles.read(dir, []);
		t.is(files.length, 2);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('fsRepoFiles skips oversized files', async t => {
	const dir = freshDir();
	try {
		write(dir, 'big.ts', 'x'.repeat(600 * 1024));
		write(dir, 'small.ts', 'ok');
		const files = await fsRepoFiles.read(dir, []);
		t.deepEqual(
			files.map(f => f.path),
			['small.ts'],
		);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('fsRepoFiles.readText returns content or null', async t => {
	const dir = freshDir();
	try {
		write(dir, 'sentinel.yaml', 'suppress: []');
		t.is(
			await fsRepoFiles.readText(join(dir, 'sentinel.yaml')),
			'suppress: []',
		);
		t.is(await fsRepoFiles.readText(join(dir, 'missing.yaml')), null);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('fsPackLoader loads enabled packs and skips underscore ones', async t => {
	const dir = freshDir();
	try {
		write(
			dir,
			'good.md',
			'---\nname: good\nversion: 1.0.0\ncategory: security\n---\nAudit.\n',
		);
		write(
			dir,
			'_starter/example.md',
			'---\nname: example\nversion: 0.1.0\n---\nAudit.\n',
		);
		const loaded = await fsPackLoader.load(dir);
		t.deepEqual(
			loaded.packs.map(p => p.manifest.name),
			['good'],
		);
		t.deepEqual(loaded.errors, []);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('fsPackLoader records parse errors for a malformed pack', async t => {
	const dir = freshDir();
	try {
		write(dir, 'broken.md', 'no frontmatter here');
		const loaded = await fsPackLoader.load(dir);
		t.is(loaded.packs.length, 0);
		t.is(loaded.errors.length, 1);
		t.is(loaded.errors[0]?.file, 'broken.md');
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});

test('fsPackLoader returns empty for a missing directory', async t => {
	const loaded = await fsPackLoader.load(join(tmpdir(), 'does-not-exist-xyz'));
	t.deepEqual(loaded.packs, []);
	t.deepEqual(loaded.errors, []);
});
