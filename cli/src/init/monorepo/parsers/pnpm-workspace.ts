/**
 * PNPM workspace configuration parser.
 * Parses pnpm-workspace.yaml to extract packages field for monorepo detection.
 */

import * as path from "node:path";
import * as TE from "fp-ts/lib/TaskEither.js";
import { parse as parseYaml } from "yaml";

/**
 * Result of parsing pnpm workspace configuration.
 */
export interface PnpmWorkspaceResult {
	/** Whether a packages field was found */
	readonly hasWorkspaces: boolean;
	/** Glob patterns for workspace locations */
	readonly workspaceGlobs: readonly string[];
}

/**
 * Parses pnpm-workspace.yaml to extract workspace glob patterns.
 *
 * Expected format:
 * ```yaml
 * packages:
 *   - 'packages/*'
 *   - 'apps/*'
 * ```
 *
 * @param rootPath - Absolute path to the directory containing pnpm-workspace.yaml
 * @returns TaskEither with parsed workspace result, never fails
 */
export const parsePnpmWorkspace = (
	rootPath: string,
): TE.TaskEither<never, PnpmWorkspaceResult> =>
	TE.tryCatch(
		async () => {
			const workspaceYamlPath = path.join(rootPath, "pnpm-workspace.yaml");
			const file = Bun.file(workspaceYamlPath);

			if (!(await file.exists())) {
				return {
					hasWorkspaces: false,
					workspaceGlobs: [],
				};
			}

			const content = await file.text();
			let parsed: unknown;

			try {
				parsed = parseYaml(content);
			} catch {
				// Malformed YAML - return empty result
				return {
					hasWorkspaces: false,
					workspaceGlobs: [],
				};
			}

			if (
				typeof parsed !== "object" ||
				parsed === null ||
				!("packages" in parsed)
			) {
				return {
					hasWorkspaces: false,
					workspaceGlobs: [],
				};
			}

			const packages = (parsed as { packages: unknown }).packages;

			if (!Array.isArray(packages)) {
				return {
					hasWorkspaces: false,
					workspaceGlobs: [],
				};
			}

			// Filter to strings and exclude negation patterns (starting with !)
			// Negation patterns are for exclusion and not actual workspace paths
			const globs = packages.filter(
				(p): p is string => typeof p === "string" && !p.startsWith("!"),
			);

			return {
				hasWorkspaces: globs.length > 0,
				workspaceGlobs: globs,
			};
		},
		// Never fails - all errors return empty result
		() =>
			({
				hasWorkspaces: false,
				workspaceGlobs: [],
			}) as never,
	);
