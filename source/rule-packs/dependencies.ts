/**
 * Resolve a rule pack's `depends_on` graph into a run order. A pack can pull in
 * a language-general or organisation-conventions pack that must run alongside
 * it; this produces the transitive closure in dependency-first order, with
 * missing dependencies and cycles reported as structured errors.
 */

import type {RulePack, RulePackError} from './types.js';

/** The outcome of resolving a dependency graph. */
export interface DependencyResult {
	/** Pack names in run order: every dependency precedes its dependents. */
	order: string[];
	/** Missing-dependency and cycle errors. Empty when resolution succeeded. */
	errors: RulePackError[];
}

/**
 * Resolve the dependency closure of `rootName` over `packs`. The root itself is
 * included, last, after everything it (transitively) depends on.
 */
export function resolveDependencies(
	packs: RulePack[],
	rootName: string,
): DependencyResult {
	const byName = new Map(packs.map(pack => [pack.manifest.name, pack]));
	const errors: RulePackError[] = [];
	const order: string[] = [];
	const resolved = new Set<string>();
	const onStack = new Set<string>();

	if (!byName.has(rootName)) {
		return {
			order: [],
			errors: [
				{field: 'depends_on', message: `unknown rule pack: ${rootName}`},
			],
		};
	}

	function visit(name: string): void {
		if (resolved.has(name)) {
			return;
		}
		if (onStack.has(name)) {
			errors.push({
				field: 'depends_on',
				message: `dependency cycle detected at rule pack: ${name}`,
			});
			return;
		}

		const pack = byName.get(name);
		if (!pack) {
			errors.push({
				field: 'depends_on',
				message: `unknown rule pack: ${name}`,
			});
			return;
		}

		onStack.add(name);
		for (const dependency of pack.manifest.dependsOn) {
			visit(dependency);
		}
		onStack.delete(name);

		resolved.add(name);
		order.push(name);
	}

	visit(rootName);

	if (errors.length > 0) {
		return {order: [], errors};
	}

	return {order, errors: []};
}
