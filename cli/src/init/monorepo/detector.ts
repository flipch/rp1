/**
 * Monorepo detection logic.
 * Identifies monorepo type from configuration files in priority order:
 * tool-based > workspace-based > language-specific.
 */

import path from "node:path";
import { pipe } from "fp-ts/lib/function.js";
import * as O from "fp-ts/lib/Option.js";
import * as TE from "fp-ts/lib/TaskEither.js";
import { parse as parseYaml } from "yaml";
import type { MonorepoDetectionResult, MonorepoType } from "./models.js";

/**
 * Configuration for a monorepo detector.
 * Each detector knows how to identify a specific monorepo type and extract workspace globs.
 */
export interface DetectorConfig {
	/** The monorepo type this detector identifies */
	readonly type: MonorepoType;
	/** Config files that indicate this monorepo type (checked in order) */
	readonly configFiles: readonly string[];
	/** Detect if this monorepo type is present at the given root */
	readonly detect: (rootPath: string) => TE.TaskEither<never, boolean>;
	/** Extract workspace glob patterns from the monorepo config */
	readonly extractGlobs: (rootPath: string) => TE.TaskEither<never, string[]>;
}

/**
 * Check if a file exists at the given path.
 */
const fileExists = (filePath: string): TE.TaskEither<never, boolean> =>
	TE.tryCatch(
		async () => {
			const file = Bun.file(filePath);
			return file.exists();
		},
		() => false as never,
	);

/**
 * Read file contents as text, returning empty string on failure.
 */
const readFileText = (filePath: string): TE.TaskEither<never, string> =>
	TE.tryCatch(
		async () => {
			const file = Bun.file(filePath);
			if (!(await file.exists())) return "";
			return file.text();
		},
		() => "" as never,
	);

/**
 * Safely parse JSON, returning null on failure.
 */
const parseJsonSafe = (content: string): unknown | null => {
	try {
		return JSON.parse(content);
	} catch {
		return null;
	}
};

/**
 * Safely parse YAML, returning null on failure.
 */
const parseYamlSafe = (content: string): unknown | null => {
	try {
		return parseYaml(content);
	} catch {
		return null;
	}
};

/**
 * Find any .sln files in the root directory.
 */
const findSlnFiles = (rootPath: string): TE.TaskEither<never, string[]> =>
	TE.tryCatch(
		async () => {
			const glob = new Bun.Glob("*.sln");
			const files: string[] = [];
			for await (const file of glob.scan({ cwd: rootPath, onlyFiles: true })) {
				files.push(file);
			}
			return files;
		},
		() => [] as never,
	);

// ============================================================================
// Tool-based Detectors (Highest Priority)
// These tools are explicit about monorepo intent
// ============================================================================

const turborepoDetector: DetectorConfig = {
	type: "turborepo",
	configFiles: ["turbo.json"],
	detect: (rootPath) =>
		pipe(
			fileExists(path.join(rootPath, "turbo.json")),
			TE.map((exists) => exists),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "package.json")),
			TE.map((content) => {
				const pkg = parseJsonSafe(content);
				if (
					pkg &&
					typeof pkg === "object" &&
					"workspaces" in pkg &&
					Array.isArray((pkg as { workspaces: unknown }).workspaces)
				) {
					return (pkg as { workspaces: string[] }).workspaces;
				}
				// Turborepo default patterns
				return ["apps/*", "packages/*"];
			}),
		),
};

const nxDetector: DetectorConfig = {
	type: "nx",
	configFiles: ["nx.json"],
	detect: (rootPath) =>
		pipe(
			fileExists(path.join(rootPath, "nx.json")),
			TE.map((exists) => exists),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "nx.json")),
			TE.map((content) => {
				const nx = parseJsonSafe(content);
				// Nx can define workspaceLayout in nx.json
				if (
					nx &&
					typeof nx === "object" &&
					"workspaceLayout" in nx &&
					typeof (nx as { workspaceLayout: unknown }).workspaceLayout ===
						"object"
				) {
					const layout = (
						nx as {
							workspaceLayout: { appsDir?: string; libsDir?: string };
						}
					).workspaceLayout;
					const dirs: string[] = [];
					if (layout.appsDir) dirs.push(`${layout.appsDir}/*`);
					if (layout.libsDir) dirs.push(`${layout.libsDir}/*`);
					if (dirs.length > 0) return dirs;
				}
				// Nx defaults
				return ["apps/*", "libs/*", "packages/*"];
			}),
		),
};

const lernaDetector: DetectorConfig = {
	type: "lerna",
	configFiles: ["lerna.json"],
	detect: (rootPath) =>
		pipe(
			fileExists(path.join(rootPath, "lerna.json")),
			TE.map((exists) => exists),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "lerna.json")),
			TE.map((content) => {
				const lerna = parseJsonSafe(content);
				if (
					lerna &&
					typeof lerna === "object" &&
					"packages" in lerna &&
					Array.isArray((lerna as { packages: unknown }).packages)
				) {
					return (lerna as { packages: string[] }).packages;
				}
				// Lerna default
				return ["packages/*"];
			}),
		),
};

const rushDetector: DetectorConfig = {
	type: "rush",
	configFiles: ["rush.json"],
	detect: (rootPath) =>
		pipe(
			fileExists(path.join(rootPath, "rush.json")),
			TE.map((exists) => exists),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "rush.json")),
			TE.map((content) => {
				const rush = parseJsonSafe(content);
				if (
					rush &&
					typeof rush === "object" &&
					"projects" in rush &&
					Array.isArray((rush as { projects: unknown }).projects)
				) {
					// Rush uses explicit project folders, extract their directories
					const projects = (rush as { projects: { projectFolder: string }[] })
						.projects;
					const dirs = new Set<string>();
					for (const proj of projects) {
						if (proj.projectFolder) {
							// Extract the first directory component for glob pattern
							const firstDir = proj.projectFolder.split("/")[0];
							dirs.add(`${firstDir}/*`);
						}
					}
					return Array.from(dirs);
				}
				return [];
			}),
		),
};

// ============================================================================
// Workspace-based Detectors
// Package manager workspace configurations
// ============================================================================

const pnpmWorkspacesDetector: DetectorConfig = {
	type: "pnpm-workspaces",
	configFiles: ["pnpm-workspace.yaml"],
	detect: (rootPath) =>
		pipe(
			fileExists(path.join(rootPath, "pnpm-workspace.yaml")),
			TE.map((exists) => exists),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "pnpm-workspace.yaml")),
			TE.map((content) => {
				const config = parseYamlSafe(content);
				if (
					config &&
					typeof config === "object" &&
					"packages" in config &&
					Array.isArray((config as { packages: unknown }).packages)
				) {
					return (config as { packages: string[] }).packages;
				}
				return [];
			}),
		),
};

const npmWorkspacesDetector: DetectorConfig = {
	type: "npm-workspaces",
	configFiles: ["package.json"],
	detect: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "package.json")),
			TE.map((content) => {
				const pkg = parseJsonSafe(content);
				return (
					pkg !== null &&
					typeof pkg === "object" &&
					"workspaces" in pkg &&
					Array.isArray((pkg as { workspaces: unknown }).workspaces)
				);
			}),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "package.json")),
			TE.map((content) => {
				const pkg = parseJsonSafe(content);
				if (
					pkg &&
					typeof pkg === "object" &&
					"workspaces" in pkg &&
					Array.isArray((pkg as { workspaces: unknown }).workspaces)
				) {
					return (pkg as { workspaces: string[] }).workspaces;
				}
				return [];
			}),
		),
};

// ============================================================================
// Language-specific Detectors
// ============================================================================

const cargoWorkspacesDetector: DetectorConfig = {
	type: "cargo-workspaces",
	configFiles: ["Cargo.toml"],
	detect: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "Cargo.toml")),
			TE.map((content) => {
				// Check for [workspace] section using regex (design decision D1: avoid full TOML parser)
				return /^\[workspace\]/m.test(content);
			}),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "Cargo.toml")),
			TE.map((content) => {
				// Extract members from [workspace] section
				// Pattern: members = ["path1", "path2"] or members = [\n"path1",\n"path2"\n]
				const membersMatch = content.match(
					/\[workspace\][^[]*?members\s*=\s*\[([\s\S]*?)\]/,
				);
				if (membersMatch) {
					const membersStr = membersMatch[1];
					const members: string[] = [];
					// Match quoted strings, handling glob patterns like "crates/*"
					const itemMatches = membersStr.matchAll(/"([^"]+)"/g);
					for (const m of itemMatches) {
						members.push(m[1]);
					}
					return members;
				}
				return [];
			}),
		),
};

const goModulesDetector: DetectorConfig = {
	type: "go-modules",
	configFiles: ["go.mod"],
	detect: (rootPath) =>
		pipe(
			TE.tryCatch(
				async () => {
					// Check for go.work file (Go workspace) or multiple go.mod files
					const goWorkExists = await Bun.file(
						path.join(rootPath, "go.work"),
					).exists();
					if (goWorkExists) return true;

					// Scan for multiple go.mod files in subdirectories
					const glob = new Bun.Glob("**/go.mod");
					const modFiles: string[] = [];
					for await (const file of glob.scan({
						cwd: rootPath,
						onlyFiles: true,
					})) {
						// Exclude vendor directory
						if (!file.startsWith("vendor/")) {
							modFiles.push(file);
						}
						// If we find more than one, it's a monorepo
						if (modFiles.length > 1) return true;
					}
					return false;
				},
				() => false as never,
			),
		),
	extractGlobs: (rootPath) =>
		pipe(
			TE.tryCatch(
				async () => {
					// Check go.work first for explicit workspace definition
					const goWorkPath = path.join(rootPath, "go.work");
					const goWorkFile = Bun.file(goWorkPath);
					if (await goWorkFile.exists()) {
						const content = await goWorkFile.text();
						// Parse use directives: use (\n./path1\n./path2\n) or use ./single
						const useMatches = content.match(/use\s*\(([\s\S]*?)\)/);
						if (useMatches) {
							const paths: string[] = [];
							const dirMatches = useMatches[1].matchAll(/^\s*\.\/([^\s]+)/gm);
							for (const m of dirMatches) {
								paths.push(m[1]);
							}
							return paths;
						}
						// Single use directive
						const singleUse = content.match(/use\s+\.\/([^\s]+)/);
						if (singleUse) {
							return [singleUse[1]];
						}
					}

					// Fallback: scan for go.mod files
					const glob = new Bun.Glob("*/go.mod");
					const dirs: string[] = [];
					for await (const file of glob.scan({
						cwd: rootPath,
						onlyFiles: true,
					})) {
						if (!file.startsWith("vendor/")) {
							dirs.push(path.dirname(file));
						}
					}
					return dirs;
				},
				() => [] as never,
			),
		),
};

const gradleMultiprojectDetector: DetectorConfig = {
	type: "gradle-multiproject",
	configFiles: ["settings.gradle", "settings.gradle.kts"],
	detect: (rootPath) =>
		pipe(
			TE.Do,
			TE.bind("gradleExists", () =>
				fileExists(path.join(rootPath, "settings.gradle")),
			),
			TE.bind("gradleKtsExists", () =>
				fileExists(path.join(rootPath, "settings.gradle.kts")),
			),
			TE.chain(({ gradleExists, gradleKtsExists }) => {
				if (!gradleExists && !gradleKtsExists) {
					return TE.right(false);
				}
				const settingsFile = gradleExists
					? "settings.gradle"
					: "settings.gradle.kts";
				return pipe(
					readFileText(path.join(rootPath, settingsFile)),
					TE.map((content) => {
						// Check for include statements
						return /include\s*\(?['"]/.test(content);
					}),
				);
			}),
		),
	extractGlobs: (rootPath) =>
		pipe(
			TE.Do,
			TE.bind("gradleExists", () =>
				fileExists(path.join(rootPath, "settings.gradle")),
			),
			TE.bind("gradleKtsExists", () =>
				fileExists(path.join(rootPath, "settings.gradle.kts")),
			),
			TE.chain(({ gradleExists, gradleKtsExists }) => {
				if (!gradleExists && !gradleKtsExists) {
					return TE.right([]);
				}
				const settingsFile = gradleExists
					? "settings.gradle"
					: "settings.gradle.kts";
				return pipe(
					readFileText(path.join(rootPath, settingsFile)),
					TE.map((content) => {
						const projects: string[] = [];
						// Match include(':project1', ':project2') or include ':project1', ':project2'
						// Also handles include(":project1") for Kotlin DSL
						const includeMatches = content.matchAll(
							/include\s*\(?['":]([^'")\n]+)/g,
						);
						for (const m of includeMatches) {
							// Convert :project:subproject to project/subproject
							const projectPath = m[1].replace(/^:/, "").replace(/:/g, "/");
							projects.push(projectPath);
						}
						return projects;
					}),
				);
			}),
		),
};

const mavenMultimoduleDetector: DetectorConfig = {
	type: "maven-multimodule",
	configFiles: ["pom.xml"],
	detect: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "pom.xml")),
			TE.map((content) => {
				// Check for <modules> section
				return /<modules>[\s\S]*?<module>/.test(content);
			}),
		),
	extractGlobs: (rootPath) =>
		pipe(
			readFileText(path.join(rootPath, "pom.xml")),
			TE.map((content) => {
				const modules: string[] = [];
				// Extract module names from <modules><module>name</module></modules>
				const moduleMatches = content.matchAll(/<module>([^<]+)<\/module>/g);
				for (const m of moduleMatches) {
					modules.push(m[1].trim());
				}
				return modules;
			}),
		),
};

const dotnetSolutionDetector: DetectorConfig = {
	type: "dotnet-solution",
	configFiles: ["*.sln"],
	detect: (rootPath) =>
		pipe(
			findSlnFiles(rootPath),
			TE.map((files) => files.length > 0),
		),
	extractGlobs: (rootPath) =>
		pipe(
			findSlnFiles(rootPath),
			TE.chain((slnFiles) => {
				if (slnFiles.length === 0) {
					return TE.right([]);
				}
				// Read the first .sln file
				return pipe(
					readFileText(path.join(rootPath, slnFiles[0])),
					TE.map((content) => {
						const projects: string[] = [];
						// Parse Project() entries: Project("{GUID}") = "Name", "path\to\proj.csproj", "{GUID}"
						// Design decision D5: Use regex, sufficient for project enumeration
						const projectMatches = content.matchAll(
							/Project\([^)]+\)\s*=\s*"[^"]+",\s*"([^"]+\.(?:csproj|fsproj|vbproj))"/gi,
						);
						for (const m of projectMatches) {
							// Extract directory from project path, normalize to forward slashes
							const projPath = m[1].replace(/\\/g, "/");
							const dir = path.dirname(projPath);
							if (dir && dir !== "." && !projects.includes(dir)) {
								projects.push(dir);
							}
						}
						return projects;
					}),
				);
			}),
		),
};

/**
 * Array of detectors in priority order.
 * Tool-based > Workspace-based > Language-specific
 */
export const DETECTORS: readonly DetectorConfig[] = [
	// Tool-based (highest priority - explicit monorepo tools)
	turborepoDetector,
	nxDetector,
	lernaDetector,
	rushDetector,
	// Workspace-based
	pnpmWorkspacesDetector,
	npmWorkspacesDetector,
	// Language-specific
	cargoWorkspacesDetector,
	goModulesDetector,
	gradleMultiprojectDetector,
	mavenMultimoduleDetector,
	dotnetSolutionDetector,
];

/**
 * Try a single detector and return the result if it matches.
 */
const tryDetector = (
	detector: DetectorConfig,
	rootPath: string,
): TE.TaskEither<never, O.Option<MonorepoDetectionResult>> =>
	pipe(
		detector.detect(rootPath),
		TE.chain((detected) => {
			if (!detected) {
				return TE.right(O.none);
			}
			return pipe(
				detector.extractGlobs(rootPath),
				TE.map((globs) =>
					O.some({
						detected: true,
						type: detector.type,
						rootPath,
						configFile: detector.configFiles[0],
						workspaceGlobs: globs,
					}),
				),
			);
		}),
	);

/**
 * Detect monorepo type at the given root path.
 * Checks detectors in priority order and returns on first match.
 *
 * Returns a result with detected: false and type: null for single-project repositories.
 *
 * @param rootPath - Absolute path to the repository root (typically git root)
 * @returns TaskEither that never fails, always returns a detection result
 */
export const detectMonorepo = (
	rootPath: string,
): TE.TaskEither<never, MonorepoDetectionResult> => {
	const notDetectedResult: MonorepoDetectionResult = {
		detected: false,
		type: null,
		rootPath,
		configFile: null,
		workspaceGlobs: [],
	};

	/**
	 * Recursively try detectors in order until one matches.
	 */
	const tryDetectorsInOrder = (
		remaining: readonly DetectorConfig[],
	): TE.TaskEither<never, MonorepoDetectionResult> => {
		if (remaining.length === 0) {
			return TE.right(notDetectedResult);
		}

		const [first, ...rest] = remaining;
		return pipe(
			tryDetector(first, rootPath),
			TE.chain((maybeResult) =>
				pipe(
					maybeResult,
					O.match(
						() => tryDetectorsInOrder(rest),
						(result) => TE.right(result),
					),
				),
			),
		);
	};

	return tryDetectorsInOrder(DETECTORS);
};
