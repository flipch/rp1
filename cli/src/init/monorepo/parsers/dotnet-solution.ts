/**
 * .NET solution file parser.
 * Parses .sln files to extract Project() entries for solution-based monorepo detection.
 */

import * as path from "node:path";
import * as TE from "fp-ts/lib/TaskEither.js";

/**
 * Result of parsing .NET solution configuration.
 */
export interface DotnetSolutionResult {
	/** Whether any projects were found in the solution */
	readonly hasProjects: boolean;
	/** Paths to project files (.csproj, .fsproj, .vbproj) relative to solution */
	readonly projectPaths: readonly string[];
	/** The name of the solution file */
	readonly solutionName: string | null;
}

/**
 * Project types to include (actual code projects, not solution folders).
 * GUID patterns from Microsoft documentation.
 */
const CODE_PROJECT_GUIDS = new Set([
	"9A19103F-16F7-4668-BE54-9A1E7A4F7556", // C# SDK-style
	"FAE04EC0-301F-11D3-BF4B-00C04F79EFBC", // C# (legacy)
	"F2A71F9B-5D33-465A-A702-920D77279786", // F#
	"6EC3EE1D-3C4E-46DD-8F32-0CC8E7565705", // F# SDK-style
	"F184B08F-C81C-45F6-A57F-5ABD9991F28F", // VB.NET
	"778DAE3C-4631-46EA-AA77-85C1314464D9", // VB.NET SDK-style
]);

/**
 * Solution folder GUID - projects of this type should be ignored.
 */
const SOLUTION_FOLDER_GUID = "2150E333-8FDC-42A3-9474-1A3956D46DE8";

/**
 * Finds and parses .sln files in a directory to extract project paths.
 *
 * Expected .sln format:
 * ```
 * Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "ProjectName", "path\to\Project.csproj", "{project-guid}"
 * EndProject
 * ```
 *
 * @param rootPath - Absolute path to the directory to scan for .sln files
 * @returns TaskEither with parsed solution result, never fails
 */
export const parseDotnetSolution = (
	rootPath: string,
): TE.TaskEither<never, DotnetSolutionResult> =>
	TE.tryCatch(
		async () => {
			// Find .sln files in the root directory
			const glob = new Bun.Glob("*.sln");
			const slnFiles: string[] = [];

			for await (const file of glob.scan({
				cwd: rootPath,
				onlyFiles: true,
			})) {
				slnFiles.push(file);
			}

			if (slnFiles.length === 0) {
				return {
					hasProjects: false,
					projectPaths: [],
					solutionName: null,
				};
			}

			// Parse the first solution file found
			const solutionFile = slnFiles[0];
			const solutionPath = path.join(rootPath, solutionFile);
			const file = Bun.file(solutionPath);
			const content = await file.text();

			const projectPaths = extractProjects(content);

			return {
				hasProjects: projectPaths.length > 0,
				projectPaths,
				solutionName: solutionFile.replace(/\.sln$/, ""),
			};
		},
		// Never fails - all errors return empty result
		() =>
			({
				hasProjects: false,
				projectPaths: [],
				solutionName: null,
			}) as never,
	);

/**
 * Extracts project paths from .sln file content using regex.
 *
 * Project lines have the format:
 * Project("{type-guid}") = "Name", "path\to\project.csproj", "{project-guid}"
 *
 * @param content - The .sln file content
 * @returns Array of project file paths (relative to solution directory)
 */
function extractProjects(content: string): string[] {
	const projects: string[] = [];

	// Regex to match Project lines
	// Captures: 1=type GUID, 2=project name, 3=project path
	const projectRegex =
		/^Project\s*\(\s*"\{([A-F0-9-]+)\}"\s*\)\s*=\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,/gim;

	let match: RegExpExecArray | null;
	while ((match = projectRegex.exec(content)) !== null) {
		const typeGuid = match[1]?.toUpperCase();
		const projectPath = match[3];

		if (!typeGuid || !projectPath) {
			continue;
		}

		// Skip solution folders
		if (typeGuid === SOLUTION_FOLDER_GUID) {
			continue;
		}

		// Only include known code project types, or any project with a recognized extension
		const isKnownProjectType = CODE_PROJECT_GUIDS.has(typeGuid);
		const hasProjectExtension = /\.(csproj|fsproj|vbproj)$/i.test(projectPath);

		if (isKnownProjectType || hasProjectExtension) {
			// Normalize path separators (Windows uses backslashes)
			const normalizedPath = projectPath.replace(/\\/g, "/");

			// Extract the directory containing the project file
			const projectDir = path.dirname(normalizedPath);
			if (projectDir && projectDir !== ".") {
				projects.push(projectDir);
			}
		}
	}

	// Deduplicate paths
	return [...new Set(projects)];
}
