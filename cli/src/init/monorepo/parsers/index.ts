/**
 * Workspace configuration parsers for monorepo detection.
 * Each parser extracts workspace/project paths from language-specific configuration files.
 */

export {
	type CargoWorkspaceResult,
	parseCargoWorkspace,
} from "./cargo-workspace.js";
export {
	type DotnetSolutionResult,
	parseDotnetSolution,
} from "./dotnet-solution.js";
export { type GoModulesResult, scanGoModules } from "./go-modules.js";
export {
	type GradleProjectResult,
	parseGradleProject,
} from "./gradle-project.js";
export {
	type MavenProjectResult,
	parseMavenProject,
} from "./maven-project.js";
export {
	type NpmWorkspaceResult,
	parseNpmWorkspace,
} from "./npm-workspace.js";
export {
	type PnpmWorkspaceResult,
	parsePnpmWorkspace,
} from "./pnpm-workspace.js";
