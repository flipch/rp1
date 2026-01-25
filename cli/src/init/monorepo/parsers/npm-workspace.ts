/**
 * NPM/Yarn workspace configuration parser.
 * Parses package.json to extract workspaces field for monorepo detection.
 */

import * as path from "node:path";
import * as TE from "fp-ts/lib/TaskEither.js";

/**
 * Result of parsing npm workspace configuration.
 */
export interface NpmWorkspaceResult {
	/** Whether a workspaces field was found */
	readonly hasWorkspaces: boolean;
	/** Glob patterns for workspace locations */
	readonly workspaceGlobs: readonly string[];
	/** Whether this is a Yarn workspace (has yarn.lock) */
	readonly isYarn: boolean;
}

/**
 * Parses package.json to extract workspace glob patterns.
 *
 * Handles both array format and object format:
 * - Array: { "workspaces": ["packages/*", "apps/*"] }
 * - Object (Yarn): { "workspaces": { "packages": ["packages/*"] } }
 *
 * @param rootPath - Absolute path to the directory containing package.json
 * @returns TaskEither with parsed workspace result, never fails
 */
export const parseNpmWorkspace = (
	rootPath: string,
): TE.TaskEither<never, NpmWorkspaceResult> =>
	TE.tryCatch(
		async () => {
			const packageJsonPath = path.join(rootPath, "package.json");
			const file = Bun.file(packageJsonPath);

			if (!(await file.exists())) {
				return {
					hasWorkspaces: false,
					workspaceGlobs: [],
					isYarn: false,
				};
			}

			const content = await file.text();
			let parsed: unknown;

			try {
				parsed = JSON.parse(content);
			} catch {
				// Malformed JSON - return empty result
				return {
					hasWorkspaces: false,
					workspaceGlobs: [],
					isYarn: false,
				};
			}

			if (
				typeof parsed !== "object" ||
				parsed === null ||
				!("workspaces" in parsed)
			) {
				return {
					hasWorkspaces: false,
					workspaceGlobs: [],
					isYarn: false,
				};
			}

			const workspaces = (parsed as { workspaces: unknown }).workspaces;
			let globs: string[] = [];

			// Handle array format: ["packages/*", "apps/*"]
			if (Array.isArray(workspaces)) {
				globs = workspaces.filter((w): w is string => typeof w === "string");
			}
			// Handle object format (Yarn workspaces): { packages: [...], nohoist: [...] }
			else if (typeof workspaces === "object" && workspaces !== null) {
				const wsObj = workspaces as Record<string, unknown>;
				if (Array.isArray(wsObj.packages)) {
					globs = wsObj.packages.filter(
						(w): w is string => typeof w === "string",
					);
				}
			}

			// Check for yarn.lock to determine if this is a Yarn workspace
			const yarnLockPath = path.join(rootPath, "yarn.lock");
			const yarnLockFile = Bun.file(yarnLockPath);
			const isYarn = await yarnLockFile.exists();

			return {
				hasWorkspaces: globs.length > 0,
				workspaceGlobs: globs,
				isYarn,
			};
		},
		// Never fails - all errors return empty result
		() =>
			({
				hasWorkspaces: false,
				workspaceGlobs: [],
				isYarn: false,
			}) as never,
	);
