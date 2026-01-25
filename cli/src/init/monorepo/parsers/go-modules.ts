/**
 * Go modules scanner for multi-module monorepo detection.
 * Scans for multiple go.mod files in subdirectories to detect Go workspaces.
 */

import * as path from "node:path";
import * as TE from "fp-ts/lib/TaskEither.js";

/**
 * Result of scanning for Go modules.
 */
export interface GoModulesResult {
	/** Whether multiple go.mod files were found (indicating a multi-module repo) */
	readonly hasMultipleModules: boolean;
	/** Paths to directories containing go.mod files, relative to root */
	readonly modulePaths: readonly string[];
	/** Whether a go.work file exists (Go 1.18+ workspace mode) */
	readonly hasGoWork: boolean;
}

/**
 * Directories to exclude from scanning.
 */
const EXCLUDED_DIRS = new Set([
	"node_modules",
	"vendor",
	".git",
	"dist",
	"build",
	"target",
	"__pycache__",
	".rp1",
]);

/**
 * Scans for go.mod files in subdirectories to detect multi-module Go repos.
 *
 * A Go multi-module repo is detected when:
 * 1. Multiple go.mod files exist in different directories, OR
 * 2. A go.work file exists (Go 1.18+ workspace mode)
 *
 * @param rootPath - Absolute path to the directory to scan
 * @param maxDepth - Maximum directory depth to scan (default: 4)
 * @returns TaskEither with scanned modules result, never fails
 */
export const scanGoModules = (
	rootPath: string,
	maxDepth: number = 4,
): TE.TaskEither<never, GoModulesResult> =>
	TE.tryCatch(
		async () => {
			const modulePaths: string[] = [];

			// Check for go.work file (Go 1.18+ workspace mode)
			const goWorkPath = path.join(rootPath, "go.work");
			const goWorkFile = Bun.file(goWorkPath);
			const hasGoWork = await goWorkFile.exists();

			// If go.work exists, parse it for workspace modules
			if (hasGoWork) {
				const workModules = await parseGoWork(rootPath);
				return {
					hasMultipleModules: workModules.length > 1,
					modulePaths: workModules,
					hasGoWork: true,
				};
			}

			// Otherwise, scan for go.mod files recursively
			await scanDirectory(rootPath, rootPath, modulePaths, 0, maxDepth);

			return {
				hasMultipleModules: modulePaths.length > 1,
				modulePaths,
				hasGoWork: false,
			};
		},
		// Never fails - all errors return empty result
		() =>
			({
				hasMultipleModules: false,
				modulePaths: [],
				hasGoWork: false,
			}) as never,
	);

/**
 * Recursively scans a directory for go.mod files.
 */
async function scanDirectory(
	rootPath: string,
	currentPath: string,
	modulePaths: string[],
	depth: number,
	maxDepth: number,
): Promise<void> {
	if (depth > maxDepth) {
		return;
	}

	try {
		const glob = new Bun.Glob("*");
		const entries: string[] = [];

		for await (const entry of glob.scan({
			cwd: currentPath,
			onlyFiles: false,
		})) {
			entries.push(entry);
		}

		for (const entry of entries) {
			const entryPath = path.join(currentPath, entry);

			// Check if this is a go.mod file
			if (entry === "go.mod") {
				const relativePath = path.relative(rootPath, currentPath);
				modulePaths.push(relativePath || ".");
				continue;
			}

			// Skip excluded directories
			if (EXCLUDED_DIRS.has(entry)) {
				continue;
			}

			// Check if it's a directory and recurse
			try {
				// Try to list as directory - if it fails, it's a file
				const subGlob = new Bun.Glob("*");
				const subEntries = [];
				for await (const subEntry of subGlob.scan({
					cwd: entryPath,
					onlyFiles: false,
				})) {
					subEntries.push(subEntry);
					break; // Just need to check if it's a directory
				}
				// If we get here, it's a directory
				await scanDirectory(
					rootPath,
					entryPath,
					modulePaths,
					depth + 1,
					maxDepth,
				);
			} catch {
				// Not a directory, skip
			}
		}
	} catch {
		// Directory read failed, skip
	}
}

/**
 * Parses go.work file to extract workspace module paths.
 */
async function parseGoWork(rootPath: string): Promise<string[]> {
	try {
		const goWorkPath = path.join(rootPath, "go.work");
		const file = Bun.file(goWorkPath);
		const content = await file.text();

		// Parse go.work format:
		// use (
		//     ./module1
		//     ./module2
		// )
		// OR
		// use ./module1
		// use ./module2
		const modules: string[] = [];

		// Match block format: use ( ... )
		const blockRegex = /use\s*\(([\s\S]*?)\)/g;
		let blockMatch: RegExpExecArray | null;
		while ((blockMatch = blockRegex.exec(content)) !== null) {
			const block = blockMatch[1];
			const pathRegex = /^\s*\.?\/?([\w\-/.]+)/gm;
			let pathMatch: RegExpExecArray | null;
			while ((pathMatch = pathRegex.exec(block)) !== null) {
				if (pathMatch[1]) {
					modules.push(pathMatch[1].replace(/^\.\//, ""));
				}
			}
		}

		// Match single-line format: use ./module
		const singleRegex = /^use\s+\.?\/?([^\s(]+)/gm;
		let singleMatch: RegExpExecArray | null;
		while ((singleMatch = singleRegex.exec(content)) !== null) {
			if (singleMatch[1] && !singleMatch[1].startsWith("(")) {
				modules.push(singleMatch[1].replace(/^\.\//, ""));
			}
		}

		// Deduplicate
		return [...new Set(modules)];
	} catch {
		return [];
	}
}
