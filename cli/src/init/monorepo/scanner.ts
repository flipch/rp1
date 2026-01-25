/**
 * Project scanner for monorepo detection.
 * Enumerates projects based on detected monorepo type and builds hierarchical tree.
 */

import * as path from "node:path";
import { pipe } from "fp-ts/lib/function.js";
import * as TE from "fp-ts/lib/TaskEither.js";
import type {
	MonorepoDetectionResult,
	ProjectMarker,
	ProjectNode,
} from "./models.js";

/**
 * Directories to exclude from scanning.
 */
const EXCLUDED_DIRS = new Set([
	"node_modules",
	"target",
	"dist",
	".git",
	"vendor",
	"build",
	"__pycache__",
	".rp1",
	".next",
	".nuxt",
	"coverage",
]);

/**
 * Project marker files to detect, in priority order.
 * More specific markers come before less specific ones.
 */
const PROJECT_MARKERS: readonly { file: string; type: ProjectMarker }[] = [
	{ file: "package.json", type: "package.json" },
	{ file: "Cargo.toml", type: "Cargo.toml" },
	{ file: "go.mod", type: "go.mod" },
	{ file: "pyproject.toml", type: "pyproject.toml" },
	{ file: "build.gradle", type: "build.gradle" },
	{ file: "build.gradle.kts", type: "build.gradle" },
	{ file: "pom.xml", type: "pom.xml" },
];

/**
 * Resolves workspace glob patterns to actual directory paths using Bun.Glob.
 *
 * @param rootPath - Absolute path to the monorepo root
 * @param globs - Array of glob patterns to resolve
 * @returns TaskEither with resolved paths, never fails
 */
export const resolveGlobPatterns = (
	rootPath: string,
	globs: readonly string[],
): TE.TaskEither<never, readonly string[]> =>
	TE.tryCatch(
		async () => {
			const resolvedPaths = new Set<string>();

			for (const pattern of globs) {
				// Normalize pattern - ensure it has a trailing wildcard if needed
				const normalizedPattern = pattern.endsWith("/*")
					? pattern
					: pattern.endsWith("/")
						? `${pattern}*`
						: pattern;

				try {
					const glob = new Bun.Glob(normalizedPattern);

					for await (const match of glob.scan({
						cwd: rootPath,
						onlyFiles: false,
					})) {
						// Check if any path component should be excluded
						const parts = match.split("/");
						if (parts.some((part) => EXCLUDED_DIRS.has(part))) {
							continue;
						}

						const fullPath = path.join(rootPath, match);
						// Verify it's a directory by trying to scan it
						try {
							const testGlob = new Bun.Glob("*");
							for await (const _ of testGlob.scan({
								cwd: fullPath,
								onlyFiles: false,
							})) {
								break;
							}
							resolvedPaths.add(fullPath);
						} catch {
							// Not a directory or not accessible
						}
					}
				} catch {
					// Invalid glob pattern, skip
				}
			}

			// Sort paths for consistent ordering
			return Array.from(resolvedPaths).sort();
		},
		() => [] as never,
	);

/**
 * Detects the project marker type for a given directory.
 * Returns the first matching marker found.
 *
 * @param projectPath - Absolute path to the project directory
 * @returns TaskEither with detected marker type, never fails
 */
export const detectProjectMarker = (
	projectPath: string,
): TE.TaskEither<never, ProjectMarker> =>
	TE.tryCatch(
		async () => {
			// Check for csproj/fsproj files first (they use glob patterns)
			try {
				const csprojGlob = new Bun.Glob("*.csproj");
				for await (const _ of csprojGlob.scan({
					cwd: projectPath,
					onlyFiles: true,
				})) {
					return "csproj" as ProjectMarker;
				}

				const fsprojGlob = new Bun.Glob("*.fsproj");
				for await (const _ of fsprojGlob.scan({
					cwd: projectPath,
					onlyFiles: true,
				})) {
					return "fsproj" as ProjectMarker;
				}
			} catch {
				// Glob scan failed, continue
			}

			// Check for standard marker files
			for (const marker of PROJECT_MARKERS) {
				const markerPath = path.join(projectPath, marker.file);
				const file = Bun.file(markerPath);
				if (await file.exists()) {
					return marker.type;
				}
			}

			return "directory" as ProjectMarker;
		},
		() => "directory" as never,
	);

/**
 * Checks if a directory has an existing .rp1/ subdirectory.
 *
 * @param projectPath - Absolute path to the project directory
 * @returns TaskEither with boolean indicating .rp1 presence, never fails
 */
const hasRp1Directory = (projectPath: string): TE.TaskEither<never, boolean> =>
	TE.tryCatch(
		async () => {
			const rp1Path = path.join(projectPath, ".rp1");
			try {
				// Check if .rp1 directory exists by trying to scan it
				const glob = new Bun.Glob("*");
				for await (const _ of glob.scan({
					cwd: rp1Path,
					onlyFiles: false,
				})) {
					return true;
				}
				// Directory exists but is empty
				return true;
			} catch {
				return false;
			}
		},
		() => false as never,
	);

/**
 * Creates a single ProjectNode for a given path.
 *
 * @param projectPath - Absolute path to the project
 * @param rootPath - Absolute path to the monorepo root
 * @param depth - Nesting depth in the tree
 * @returns TaskEither with the project node, never fails
 */
const createProjectNode = (
	projectPath: string,
	rootPath: string,
	depth: number,
): TE.TaskEither<never, ProjectNode> =>
	pipe(
		TE.Do,
		TE.bind("type", () => detectProjectMarker(projectPath)),
		TE.bind("hasRp1", () => hasRp1Directory(projectPath)),
		TE.map(({ type, hasRp1 }) => {
			const relativePath = path.relative(rootPath, projectPath);
			const name = path.basename(projectPath);

			return {
				path: projectPath,
				relativePath: relativePath || ".",
				name,
				type,
				hasRp1,
				depth,
				children: [] as readonly ProjectNode[],
			};
		}),
	);

/**
 * Builds a hierarchical tree structure from flat project paths.
 * Projects are nested based on path hierarchy.
 *
 * @param rootPath - Absolute path to the monorepo root
 * @param projectPaths - Array of absolute project paths
 * @returns TaskEither with tree of project nodes, never fails
 */
export const buildProjectTree = (
	rootPath: string,
	projectPaths: readonly string[],
): TE.TaskEither<never, readonly ProjectNode[]> =>
	TE.tryCatch(
		async () => {
			if (projectPaths.length === 0) {
				return [];
			}

			// First, create all project nodes
			const nodesMap = new Map<string, ProjectNode>();

			for (const projectPath of projectPaths) {
				const relativePath = path.relative(rootPath, projectPath);
				const depth = relativePath.split("/").filter((p) => p).length;
				const nodeResult = await createProjectNode(
					projectPath,
					rootPath,
					depth,
				)();

				if (nodeResult._tag === "Right") {
					nodesMap.set(projectPath, nodeResult.right);
				}
			}

			// Build the tree by finding parent-child relationships
			const rootNodes: ProjectNode[] = [];
			const sortedPaths = Array.from(nodesMap.keys()).sort();

			for (const projectPath of sortedPaths) {
				const node = nodesMap.get(projectPath);
				if (!node) continue;

				// Find if this project has a parent in the project list
				let foundParent = false;
				let currentPath = path.dirname(projectPath);

				while (currentPath !== rootPath && currentPath.startsWith(rootPath)) {
					if (nodesMap.has(currentPath)) {
						// Found a parent - add this node as a child
						const parent = nodesMap.get(currentPath);
						if (parent) {
							const updatedParent: ProjectNode = {
								...parent,
								children: [...parent.children, node],
							};
							nodesMap.set(currentPath, updatedParent);
						}
						foundParent = true;
						break;
					}
					currentPath = path.dirname(currentPath);
				}

				if (!foundParent) {
					rootNodes.push(node);
				}
			}

			// Sort root nodes by relative path
			rootNodes.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

			// Recursively sort children and update depths
			const sortChildren = (nodes: ProjectNode[]): ProjectNode[] => {
				return nodes.map((node) => ({
					...node,
					children: sortChildren([...node.children]).sort((a, b) =>
						a.name.localeCompare(b.name),
					),
				}));
			};

			return sortChildren(rootNodes);
		},
		() => [] as never,
	);

/**
 * Scans for additional project directories not covered by workspace globs.
 * This handles cases where nested workspaces or standalone projects exist.
 *
 * @param rootPath - Absolute path to the monorepo root
 * @param existingPaths - Already discovered project paths
 * @param maxDepth - Maximum depth to scan
 * @returns TaskEither with additional project paths found, never fails
 */
const scanForAdditionalProjects = (
	rootPath: string,
	existingPaths: Set<string>,
	maxDepth: number = 3,
): TE.TaskEither<never, readonly string[]> =>
	TE.tryCatch(
		async () => {
			const additionalPaths: string[] = [];

			const scanDir = async (dirPath: string, depth: number): Promise<void> => {
				if (depth > maxDepth) return;

				try {
					const glob = new Bun.Glob("*");
					const entries: string[] = [];

					for await (const entry of glob.scan({
						cwd: dirPath,
						onlyFiles: false,
					})) {
						entries.push(entry);
					}

					for (const entry of entries) {
						if (EXCLUDED_DIRS.has(entry)) continue;

						const entryPath = path.join(dirPath, entry);

						// Skip if already in existing paths
						if (existingPaths.has(entryPath)) continue;

						// Check if this is a directory with a project marker
						try {
							const isProject = await hasProjectMarker(entryPath);
							if (isProject && !existingPaths.has(entryPath)) {
								additionalPaths.push(entryPath);
							}

							// Recurse into subdirectories
							const testGlob = new Bun.Glob("*");
							let isDir = false;
							for await (const _ of testGlob.scan({
								cwd: entryPath,
								onlyFiles: false,
							})) {
								isDir = true;
								break;
							}
							if (isDir) {
								await scanDir(entryPath, depth + 1);
							}
						} catch {
							// Not accessible, skip
						}
					}
				} catch {
					// Directory scan failed
				}
			};

			await scanDir(rootPath, 0);
			return additionalPaths;
		},
		() => [] as never,
	);

/**
 * Checks if a directory contains any project marker file.
 */
async function hasProjectMarker(dirPath: string): Promise<boolean> {
	// Check for csproj/fsproj files
	try {
		const csprojGlob = new Bun.Glob("*.csproj");
		for await (const _ of csprojGlob.scan({ cwd: dirPath, onlyFiles: true })) {
			return true;
		}
		const fsprojGlob = new Bun.Glob("*.fsproj");
		for await (const _ of fsprojGlob.scan({ cwd: dirPath, onlyFiles: true })) {
			return true;
		}
	} catch {
		// Scan failed
	}

	// Check for standard markers
	for (const marker of PROJECT_MARKERS) {
		const markerPath = path.join(dirPath, marker.file);
		const file = Bun.file(markerPath);
		if (await file.exists()) {
			return true;
		}
	}

	return false;
}

/**
 * Scans for projects in a detected monorepo.
 * Resolves workspace glob patterns and builds a hierarchical project tree.
 *
 * @param detection - Result from monorepo detection
 * @returns TaskEither with project tree, never fails (returns empty array on error)
 */
export const scanProjects = (
	detection: MonorepoDetectionResult,
): TE.TaskEither<never, readonly ProjectNode[]> => {
	if (!detection.detected || detection.workspaceGlobs.length === 0) {
		// No monorepo or no workspace globs - try to discover projects
		return pipe(
			scanForAdditionalProjects(detection.rootPath, new Set(), 3),
			TE.chain((paths) => buildProjectTree(detection.rootPath, paths)),
		);
	}

	return pipe(
		resolveGlobPatterns(detection.rootPath, detection.workspaceGlobs),
		TE.chain((resolvedPaths) => {
			const pathSet = new Set(resolvedPaths);

			// Scan for additional projects not covered by globs
			return pipe(
				scanForAdditionalProjects(detection.rootPath, pathSet, 3),
				TE.map((additionalPaths) => {
					// Combine and deduplicate paths
					const allPaths = [...resolvedPaths, ...additionalPaths];
					return [...new Set(allPaths)].sort();
				}),
			);
		}),
		TE.chain((allPaths) => buildProjectTree(detection.rootPath, allPaths)),
	);
};
