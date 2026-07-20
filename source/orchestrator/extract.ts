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
 * Return the last top-level JSON array in the output that parses to an array,
 * as a string, or null if there is none.
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
	return null;
}
