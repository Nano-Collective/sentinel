/**
 * Command-line flag parsing for `sentinel run` and `sentinel estimate`.
 *
 * Every occurrence of a flag is kept rather than the last one overwriting the
 * rest. That is what `--rule-pack` needs: the help text has always presented it
 * as the mechanism for choosing packs in local mode, while the parser stored a
 * single value, so `--rule-pack a --rule-pack b` silently ran only `b`.
 *
 * Single-valued flags keep their existing last-one-wins behaviour, so nothing
 * else changes shape.
 */

/** One occurrence of a flag: its value, or `true` when it carries none. */
export type FlagValue = string | true;

/** Parsed flags, in the order each was given. */
export type Flags = Map<string, FlagValue[]>;

/** Parse `--key value`, `--key=value` and bare `--key` out of an argv tail. */
export function parseFlags(argv: string[]): Flags {
	const flags: Flags = new Map();
	const push = (key: string, value: FlagValue): void => {
		const existing = flags.get(key);
		if (existing) {
			existing.push(value);
		} else {
			flags.set(key, [value]);
		}
	};

	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token || !token.startsWith('--')) {
			continue;
		}
		const body = token.slice(2);
		const eq = body.indexOf('=');
		if (eq !== -1) {
			push(body.slice(0, eq), body.slice(eq + 1));
			continue;
		}
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith('--')) {
			push(body, next);
			i++;
		} else {
			push(body, true);
		}
	}
	return flags;
}

/**
 * The value of a single-valued flag. Last occurrence wins, which is what a
 * shell user expects from `--config a --config b` and matches the behaviour
 * before flags became repeatable.
 */
export function flagStr(flags: Flags, key: string): string | undefined {
	const values = flags.get(key);
	if (!values) {
		return undefined;
	}
	for (let i = values.length - 1; i >= 0; i--) {
		const value = values[i];
		if (typeof value === 'string') {
			return value;
		}
	}
	return undefined;
}

/** Every value given for a repeatable flag, in order. */
export function flagAll(flags: Flags, key: string): string[] {
	return (flags.get(key) ?? []).filter(
		(value): value is string => typeof value === 'string',
	);
}

/** True if a boolean flag was given with no value (`--dry-run`). */
export function flagBool(flags: Flags, key: string): boolean {
	return (flags.get(key) ?? []).includes(true);
}
