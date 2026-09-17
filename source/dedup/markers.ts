/**
 * Hidden HTML-comment markers embedded in an issue body. They carry the
 * machine state dedup needs across runs — the finding's content hash, the
 * last-seen timestamp, and the consecutive-miss counter — without a database.
 * Implemented with plain string search (no dynamic RegExp) so values are opaque.
 */

const PREFIX = 'sentinel';
const COMMENT_OPEN = '<!--';
const OPEN = `${COMMENT_OPEN} ${PREFIX}:`;
const CLOSE = ' -->';

function open(key: string): string {
	return `${OPEN}${key}=`;
}

/**
 * Where the well-formed marker for `key` sits, or null if there is none. Issue
 * bodies quote code from the audited repository, so an opener in the body is
 * not necessarily a marker: quoted ones are skipped rather than spliced
 * against, which would corrupt the body instead of updating a marker.
 */
function findMarker(
	body: string,
	key: string,
): {start: number; valueStart: number; valueEnd: number} | null {
	const opener = open(key);
	for (
		let start = body.indexOf(opener);
		start !== -1;
		start = body.indexOf(opener, start + opener.length)
	) {
		const valueStart = start + opener.length;
		const valueEnd = body.indexOf(CLOSE, valueStart);
		if (valueEnd === -1) {
			// No close after this opener means none after any later one either.
			return null;
		}
		// A real marker is a single-line comment holding an opaque scalar. A
		// value spanning a line break or another comment opener means this
		// opener was quoted text that borrowed a later marker's close.
		const value = body.slice(valueStart, valueEnd);
		if (!value.includes('\n') && !value.includes(COMMENT_OPEN)) {
			return {start, valueStart, valueEnd};
		}
	}
	return null;
}

/**
 * Neutralise marker syntax in model-authored text. Findings echo code read from
 * the audited repository, so a snippet can carry a literal marker opener; left
 * intact it collides with Sentinel's own markers. The zero-width space keeps
 * the text visually identical while breaking the match.
 */
export function defuseMarkers(text: string): string {
	return text.replaceAll(OPEN, `${COMMENT_OPEN} ${PREFIX}\u200B:`);
}

/** Read a marker's value from a body, or null if absent. */
export function readMarker(body: string, key: string): string | null {
	const found = findMarker(body, key);
	return found === null ? null : body.slice(found.valueStart, found.valueEnd);
}

/** Add or replace a marker, returning the updated body. */
export function upsertMarker(body: string, key: string, value: string): string {
	const marker = `${open(key)}${value}${CLOSE}`;
	const found = findMarker(body, key);
	if (found === null) {
		return `${body}\n${marker}`;
	}
	return (
		body.slice(0, found.start) +
		marker +
		body.slice(found.valueEnd + CLOSE.length)
	);
}

/** Read the consecutive-miss counter, defaulting to 0. */
export function readMisses(body: string): number {
	const raw = readMarker(body, 'misses');
	const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? 0 : parsed;
}
