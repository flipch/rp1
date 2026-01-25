/**
 * Type definitions for monorepo detection and project selection.
 * Provides types for detecting monorepo structures, enumerating projects,
 * and managing the interactive project selection UI state.
 */

/**
 * Supported monorepo types.
 * Each type corresponds to a specific configuration pattern or tool.
 */
export type MonorepoType =
	| "npm-workspaces" // package.json with workspaces field
	| "pnpm-workspaces" // pnpm-workspace.yaml
	| "yarn-workspaces" // package.json workspaces (yarn-specific)
	| "turborepo" // turbo.json present
	| "nx" // nx.json present
	| "lerna" // lerna.json present
	| "rush" // rush.json present
	| "cargo-workspaces" // Cargo.toml with [workspace]
	| "go-modules" // Multiple go.mod files
	| "gradle-multiproject" // settings.gradle with include
	| "maven-multimodule" // pom.xml with modules
	| "dotnet-solution"; // .sln file with projects

/**
 * Result of monorepo detection.
 * Captures whether a monorepo was detected, its type, and workspace configuration.
 */
export interface MonorepoDetectionResult {
	/** Whether a monorepo structure was detected */
	readonly detected: boolean;
	/** The type of monorepo detected, or null if not a monorepo */
	readonly type: MonorepoType | null;
	/** Absolute path to the monorepo root directory */
	readonly rootPath: string;
	/** Path to the configuration file that identified the monorepo, or null */
	readonly configFile: string | null;
	/** Glob patterns for workspace/project locations */
	readonly workspaceGlobs: readonly string[];
}

/**
 * Project marker types.
 * Identifies the type of project based on marker files present.
 */
export type ProjectMarker =
	| "package.json"
	| "Cargo.toml"
	| "go.mod"
	| "pyproject.toml"
	| "build.gradle"
	| "pom.xml"
	| "csproj"
	| "fsproj"
	| "directory"; // No specific marker, just a directory

/**
 * A project node in the tree.
 * Represents a single project within the monorepo hierarchy.
 */
export interface ProjectNode {
	/** Absolute path to the project directory */
	readonly path: string;
	/** Path relative to the monorepo root */
	readonly relativePath: string;
	/** Display name (directory name or package name) */
	readonly name: string;
	/** Type of project marker detected */
	readonly type: ProjectMarker;
	/** Whether this project has an existing .rp1/ directory */
	readonly hasRp1: boolean;
	/** Nesting depth in the tree (0 = root) */
	readonly depth: number;
	/** Child project nodes for nested structures */
	readonly children: readonly ProjectNode[];
}

/**
 * Tree view state for the ProjectTree UI component.
 * Manages search filtering and selection state.
 */
export interface ProjectTreeState {
	/** Current search query for fuzzy filtering */
	readonly searchQuery: string;
	/** Projects that match the current search query */
	readonly filteredProjects: readonly ProjectNode[];
	/** Index of the currently selected item in the filtered list */
	readonly selectedIndex: number;
	/** Total number of projects before filtering */
	readonly totalCount: number;
}
