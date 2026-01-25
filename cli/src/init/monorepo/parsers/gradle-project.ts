/**
 * Gradle multi-project configuration parser.
 * Parses settings.gradle or settings.gradle.kts to extract included projects.
 */

import * as path from "node:path";
import * as TE from "fp-ts/lib/TaskEither.js";

/**
 * Result of parsing Gradle project configuration.
 */
export interface GradleProjectResult {
	/** Whether this is a multi-project Gradle build */
	readonly hasMultiProject: boolean;
	/** Paths to included subprojects */
	readonly projectPaths: readonly string[];
	/** Whether using Kotlin DSL (settings.gradle.kts) */
	readonly isKotlinDsl: boolean;
}

/**
 * Parses settings.gradle or settings.gradle.kts to extract included projects.
 *
 * Expected formats:
 * ```groovy
 * // Groovy DSL
 * include 'subproject1', 'subproject2'
 * include ':nested:project'
 * include(":kotlin:style")
 * ```
 *
 * ```kotlin
 * // Kotlin DSL
 * include("subproject1", "subproject2")
 * include(":nested:project")
 * ```
 *
 * @param rootPath - Absolute path to the directory containing settings.gradle
 * @returns TaskEither with parsed project result, never fails
 */
export const parseGradleProject = (
	rootPath: string,
): TE.TaskEither<never, GradleProjectResult> =>
	TE.tryCatch(
		async () => {
			// Check for both Groovy and Kotlin DSL files
			const groovyPath = path.join(rootPath, "settings.gradle");
			const kotlinPath = path.join(rootPath, "settings.gradle.kts");

			const groovyFile = Bun.file(groovyPath);
			const kotlinFile = Bun.file(kotlinPath);

			const groovyExists = await groovyFile.exists();
			const kotlinExists = await kotlinFile.exists();

			// Prefer Kotlin DSL if both exist
			const isKotlinDsl = kotlinExists;
			const settingsFile = isKotlinDsl ? kotlinFile : groovyFile;

			if (!groovyExists && !kotlinExists) {
				return {
					hasMultiProject: false,
					projectPaths: [],
					isKotlinDsl: false,
				};
			}

			const content = await settingsFile.text();
			const projects = extractIncludedProjects(content);

			return {
				hasMultiProject: projects.length > 0,
				projectPaths: projects,
				isKotlinDsl,
			};
		},
		// Never fails - all errors return empty result
		() =>
			({
				hasMultiProject: false,
				projectPaths: [],
				isKotlinDsl: false,
			}) as never,
	);

/**
 * Extracts included project paths from settings.gradle content.
 * Handles both Groovy and Kotlin DSL formats.
 *
 * @param content - The settings.gradle file content
 * @returns Array of project paths, converted from Gradle notation to file paths
 */
function extractIncludedProjects(content: string): string[] {
	const projects: string[] = [];

	// Match various include patterns:
	// include 'project1', 'project2'
	// include('project1', 'project2')
	// include(':project1', ':project2')
	// include ":project1"
	// include(":project1")

	// Regex to match include statements with arguments
	// Handles both quoted strings and function call syntax
	const includeRegex =
		/include\s*\(?\s*(?:["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])*|"([^"]+)"(?:\s*,\s*"([^"]+)")*)\s*\)?/g;

	let match: RegExpExecArray | null;
	while ((match = includeRegex.exec(content)) !== null) {
		// Process all captured groups
		for (let i = 1; i < match.length; i++) {
			if (match[i]) {
				const projectPath = gradlePathToFilePath(match[i]);
				if (projectPath) {
					projects.push(projectPath);
				}
			}
		}
	}

	// Also try a simpler line-by-line approach for edge cases
	const lines = content.split("\n");
	for (const line of lines) {
		// Skip comments
		if (line.trim().startsWith("//") || line.trim().startsWith("/*")) {
			continue;
		}

		// Find include statements
		if (line.includes("include")) {
			// Extract all quoted strings from this line
			const quotedRegex = /["']([^"']+)["']/g;
			let quotedMatch: RegExpExecArray | null;
			while ((quotedMatch = quotedRegex.exec(line)) !== null) {
				if (quotedMatch[1]) {
					const projectPath = gradlePathToFilePath(quotedMatch[1]);
					if (projectPath && !projects.includes(projectPath)) {
						projects.push(projectPath);
					}
				}
			}
		}
	}

	return projects;
}

/**
 * Converts Gradle project notation to file path.
 *
 * Gradle uses colon-separated notation:
 * - ':subproject' -> 'subproject'
 * - ':nested:project' -> 'nested/project'
 * - 'subproject' -> 'subproject'
 *
 * @param gradlePath - The Gradle project path notation
 * @returns The corresponding file system path
 */
function gradlePathToFilePath(gradlePath: string): string {
	// Remove leading colon if present
	let cleaned = gradlePath.startsWith(":") ? gradlePath.slice(1) : gradlePath;

	// Replace colons with path separators
	cleaned = cleaned.replace(/:/g, "/");

	return cleaned;
}
