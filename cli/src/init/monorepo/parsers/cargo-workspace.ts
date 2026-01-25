/**
 * Cargo workspace configuration parser.
 * Parses Cargo.toml to extract [workspace] members via regex.
 * Uses regex instead of a full TOML parser to avoid adding dependencies.
 */

import * as path from "node:path";
import * as TE from "fp-ts/lib/TaskEither.js";

/**
 * Result of parsing Cargo workspace configuration.
 */
export interface CargoWorkspaceResult {
	/** Whether a [workspace] section with members was found */
	readonly hasWorkspace: boolean;
	/** Workspace member paths (not globs - Cargo uses explicit paths) */
	readonly workspaceMembers: readonly string[];
	/** Optional exclude patterns */
	readonly excludePatterns: readonly string[];
}

/**
 * Parses Cargo.toml to extract workspace members using regex.
 *
 * Expected format:
 * ```toml
 * [workspace]
 * members = [
 *   "crates/foo",
 *   "crates/bar",
 * ]
 * exclude = ["crates/experimental"]
 * ```
 *
 * @param rootPath - Absolute path to the directory containing Cargo.toml
 * @returns TaskEither with parsed workspace result, never fails
 */
export const parseCargoWorkspace = (
	rootPath: string,
): TE.TaskEither<never, CargoWorkspaceResult> =>
	TE.tryCatch(
		async () => {
			const cargoTomlPath = path.join(rootPath, "Cargo.toml");
			const file = Bun.file(cargoTomlPath);

			if (!(await file.exists())) {
				return {
					hasWorkspace: false,
					workspaceMembers: [],
					excludePatterns: [],
				};
			}

			const content = await file.text();

			// Check if there's a [workspace] section
			const workspaceSectionRegex = /^\s*\[workspace\]/m;
			if (!workspaceSectionRegex.test(content)) {
				return {
					hasWorkspace: false,
					workspaceMembers: [],
					excludePatterns: [],
				};
			}

			// Extract members array
			// Handles multi-line arrays with various formatting
			const members = extractTomlArray(content, "members");
			const exclude = extractTomlArray(content, "exclude");

			return {
				hasWorkspace: members.length > 0,
				workspaceMembers: members,
				excludePatterns: exclude,
			};
		},
		// Never fails - all errors return empty result
		() =>
			({
				hasWorkspace: false,
				workspaceMembers: [],
				excludePatterns: [],
			}) as never,
	);

/**
 * Extracts a TOML array field value using regex.
 * Handles both single-line and multi-line array formats.
 *
 * @param content - The TOML file content
 * @param fieldName - The name of the array field to extract (e.g., "members")
 * @returns Array of string values, or empty array if not found
 */
function extractTomlArray(content: string, fieldName: string): string[] {
	// Match field = [...] with potential multi-line content
	// This regex captures everything between the brackets after the field name
	const fieldRegex = new RegExp(
		`^\\s*${fieldName}\\s*=\\s*\\[([^\\]]*?)\\]`,
		"ms",
	);

	const match = content.match(fieldRegex);
	if (!match?.[1]) {
		return [];
	}

	const arrayContent = match[1];

	// Extract all quoted strings from the array content
	// Handles both single and double quotes
	const stringRegex = /["']([^"']+)["']/g;
	const values: string[] = [];

	let stringMatch: RegExpExecArray | null;
	while ((stringMatch = stringRegex.exec(arrayContent)) !== null) {
		if (stringMatch[1]) {
			values.push(stringMatch[1]);
		}
	}

	return values;
}
