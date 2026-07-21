/**
 * Hidden HTML-comment markers embedded in an issue body. They carry the
 * machine state dedup needs across runs — the finding's content hash, the
 * last-seen timestamp, and the consecutive-miss counter — without a database.
 * Implemented with plain string search (no dynamic RegExp) so values are opaque.
 */

const PREFIX = 'sentinel';
const CLOSE = ' -->';

function open(key: string): string {
	return `<!-- ${PREFIX}:${key}=`;
}

/** Read a marker's value from a body, or null if absent. */
export function readMarker(body: string, key: string): string | null {
	const start = body.indexOf(open(key));
	if (start === -1) {
		return null;
	}
	const valueStart = start + open(key).length;
	const valueEnd = body.indexOf(CLOSE, valueStart);
	if (valueEnd === -1) {
		return null;
	}
	return body.slice(valueStart, valueEnd);
}

/** Add or replace a marker, returning the updated body. */
export function upsertMarker(body: string, key: string, value: string): string {
	const marker = `${open(key)}${value}${CLOSE}`;
	const start = body.indexOf(open(key));
	if (start === -1) {
		return `${body}\n${marker}`;
	}
	const valueEnd = body.indexOf(CLOSE, start);
	const end = valueEnd + CLOSE.length;
	return body.slice(0, start) + marker + body.slice(end);
}

/** Read the consecutive-miss counter, defaulting to 0. */
export function readMisses(body: string): number {
	const raw = readMarker(body, 'misses');
	const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? 0 : parsed;
}
