/**
 * Monorepo detection and project selection module.
 * Exports all types and utilities for monorepo handling during init.
 */

export { DETECTORS, type DetectorConfig, detectMonorepo } from "./detector.js";
export type {
	MonorepoDetectionResult,
	MonorepoType,
	ProjectMarker,
	ProjectNode,
	ProjectTreeState,
} from "./models.js";
export {
	buildProjectTree,
	detectProjectMarker,
	resolveGlobPatterns,
	scanProjects,
} from "./scanner.js";
