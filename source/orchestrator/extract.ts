/**
 * Pull the findings JSON array out of a model's raw output. Even when the
 * prompt asks for "only a JSON array", a Nanocoder run emits a full agent
 * transcript, so the array is usually surrounded by reasoning and may be
 * wrapped in a code fence. This scans for balanced, top-level `[...]` spans
 * (ignoring brackets inside strings) and returns the last one that parses as
 * an array — the model's final answer.
 */

/** Collect every balanced, top-level `[...]` substring, in order. */
function topLevelArraySpans(text: string): string[] {
	const spans: string[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
		} else if (char === '[') {
			if (depth === 0) {
				start = i;
			}
			depth++;
		} else if (char === ']') {
			if (depth > 0) {
				depth--;
				if (depth === 0 && start !== -1) {
					spans.push(text.slice(start, i + 1));
					start = -1;
				}
			}
		}
	}

	return spans;
}

/**
 * Recover complete objects from a truncated array-of-objects. Models
 * occasionally cut off mid-array (max tokens), leaving `[{...},{...},{incomp`
 * which parses as nothing. This finds the last `[` that opens an object array
 * and keeps the leading complete `{...}` objects. Returns null if nothing
 * recoverable. Only used as a fallback when a clean array was not found.
 */
function salvageTruncatedArray(output: string): string | null {
	// Find the last top-level `[` immediately followed by `{` (an object array),
	// tracking string state so brackets inside strings are ignored.
	let inString = false;
	let escaped = false;
	let start = -1;
	for (let i = 0; i < output.length; i++) {
		const char = output[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
		} else if (char === '[') {
			const next = output.slice(i + 1).match(/^\s*\{/);
			if (next) {
				start = i;
			}
		}
	}
	if (start === -1) {
		return null;
	}

	// Collect balanced top-level {...} objects from just after the `[`.
	const objects: string[] = [];
	let depth = 0;
	let objectStart = -1;
	inString = false;
	escaped = false;
	for (let i = start + 1; i < output.length; i++) {
		const char = output[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
		} else if (char === '{') {
			if (depth === 0) {
				objectStart = i;
			}
			depth++;
		} else if (char === '}') {
			depth--;
			if (depth === 0 && objectStart !== -1) {
				objects.push(output.slice(objectStart, i + 1));
				objectStart = -1;
			}
		} else if (char === ']' && depth === 0) {
			break;
		}
	}

	if (objects.length === 0) {
		return null;
	}
	const salvaged = `[${objects.join(',')}]`;
	try {
		return Array.isArray(JSON.parse(salvaged)) ? salvaged : null;
	} catch {
		return null;
	}
}

/**
 * Return the last top-level JSON array in the output that parses to an array,
 * as a string, or null if there is none. Falls back to salvaging a truncated
 * array of objects.
 */
export function extractJsonArray(output: string): string | null {
	const spans = topLevelArraySpans(output);
	for (let i = spans.length - 1; i >= 0; i--) {
		const span = spans[i] as string;
		try {
			if (Array.isArray(JSON.parse(span))) {
				return span;
			}
		} catch {
			// Not valid JSON on its own; try the next candidate.
		}
	}
	return salvageTruncatedArray(output);
}
