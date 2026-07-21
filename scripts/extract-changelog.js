#!/usr/bin/env node

/**
 * Extract the changelog section for a specific version from CHANGELOG.md.
 * Usage: node scripts/extract-changelog.js [version]
 * If no version is provided, reads from package.json.
 */

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

let version = process.argv[2];
if (!version) {
	const packageJson = JSON.parse(
		readFileSync(join(rootDir, 'package.json'), 'utf-8'),
	);
	version = packageJson.version;
}

let changelogContent;
try {
	changelogContent = readFileSync(join(rootDir, 'CHANGELOG.md'), 'utf-8');
} catch (error) {
	console.error('Error reading CHANGELOG.md:', error.message);
	process.exit(1);
}

// Support: "## [version] - date", "## version", and "# version" headings.
const versionPatterns = [
	new RegExp(
		`##+ \\[?${version.replace(/\./g, '\\.')}\\]?.*?\\n([\\s\\S]*?)(?=\\n##+ |$)`,
	),
	new RegExp(
		`#+ ${version.replace(/\./g, '\\.')}.*?\\n([\\s\\S]*?)(?=\\n#+ |$)`,
	),
];

let match = null;
for (const pattern of versionPatterns) {
	match = changelogContent.match(pattern);
	if (match) break;
}

if (!match) {
	console.error(`No changelog entry found for version ${version}`);
	console.error(`Add an entry to CHANGELOG.md, e.g. "# ${version}".`);
	process.exit(1);
}

console.log(match[1].trim());
