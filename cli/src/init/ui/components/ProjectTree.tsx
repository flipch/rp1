/**
 * ProjectTree component for interactive project selection in monorepos.
 * Provides keyboard-navigable tree view with fuzzy search and visual indicators.
 *
 * @see design.md#3.4-projecttree-component
 */

import figures from "figures";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	MonorepoType,
	ProjectMarker,
	ProjectNode,
} from "../../monorepo/index.js";
import { colors, spacing } from "../styles/theme.js";

/**
 * Props for the ProjectTree component.
 */
export interface ProjectTreeProps {
	/** List of project nodes to display */
	readonly projects: readonly ProjectNode[];
	/** Absolute path to the monorepo root */
	readonly monorepoRoot: string;
	/** Type of monorepo detected */
	readonly monorepoType: MonorepoType;
	/** Current working directory for pre-selection */
	readonly currentDir: string;
	/** Callback when a project is selected */
	readonly onSelect: (path: string) => void;
	/** Callback when selection is cancelled */
	readonly onCancel: () => void;
}

/**
 * Flattened node for display purposes.
 * Includes the original node plus display metadata.
 */
interface FlattenedNode {
	readonly node: ProjectNode;
	readonly isRoot: boolean;
}

/**
 * Get the display label for a monorepo type.
 */
const getMonorepoTypeLabel = (type: MonorepoType): string => {
	const labels: Record<MonorepoType, string> = {
		"npm-workspaces": "npm workspaces",
		"pnpm-workspaces": "pnpm workspaces",
		"yarn-workspaces": "yarn workspaces",
		turborepo: "Turborepo",
		nx: "Nx",
		lerna: "Lerna",
		rush: "Rush",
		"cargo-workspaces": "Cargo workspace",
		"go-modules": "Go modules",
		"gradle-multiproject": "Gradle multi-project",
		"maven-multimodule": "Maven multi-module",
		"dotnet-solution": ".NET solution",
	};
	return labels[type];
};

/**
 * Get the visual indicator for a project marker type.
 */
const getMarkerIndicator = (marker: ProjectMarker, isRoot: boolean): string => {
	if (isRoot) return "[root]";

	const indicators: Record<ProjectMarker, string> = {
		"package.json": "[package]",
		"Cargo.toml": "[crate]",
		"go.mod": "[module]",
		"pyproject.toml": "[project]",
		"build.gradle": "[project]",
		"pom.xml": "[project]",
		csproj: "[project]",
		fsproj: "[project]",
		directory: "[dir]",
	};
	return indicators[marker];
};

/**
 * Flatten the tree structure for display.
 * Traverses depth-first to maintain visual hierarchy.
 */
const flattenTree = (
	nodes: readonly ProjectNode[],
	monorepoRoot: string,
): readonly FlattenedNode[] => {
	const result: FlattenedNode[] = [];

	// Add root as first entry
	result.push({
		node: {
			path: monorepoRoot,
			relativePath: ".",
			name: ".",
			type: "directory",
			hasRp1: false,
			depth: 0,
			children: [],
		},
		isRoot: true,
	});

	const traverse = (items: readonly ProjectNode[]): void => {
		for (const node of items) {
			result.push({ node, isRoot: false });
			if (node.children.length > 0) {
				traverse(node.children);
			}
		}
	};

	traverse(nodes);
	return result;
};

/**
 * Fuzzy match a query against a target string.
 * Case-insensitive substring matching on both name and path.
 */
const fuzzyMatch = (query: string, node: ProjectNode): boolean => {
	if (!query) return true;
	const lowerQuery = query.toLowerCase();
	const lowerName = node.name.toLowerCase();
	const lowerPath = node.relativePath.toLowerCase();
	return lowerName.includes(lowerQuery) || lowerPath.includes(lowerQuery);
};

/**
 * ProjectTree component for interactive monorepo project selection.
 *
 * Features:
 * - Hierarchical tree view with indentation
 * - Fuzzy search filtering (shown when >10 projects)
 * - Keyboard navigation (arrows, Enter, Escape, typing)
 * - Visual indicators for project types
 * - Recommendation badges
 */
export const ProjectTree: React.FC<ProjectTreeProps> = ({
	projects,
	monorepoRoot,
	monorepoType,
	currentDir,
	onSelect,
	onCancel,
}) => {
	// Flatten tree for display
	const allNodes = useMemo(
		() => flattenTree(projects, monorepoRoot),
		[projects, monorepoRoot],
	);

	// State
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);

	// Filter nodes based on search query
	const filteredNodes = useMemo(() => {
		if (!searchQuery) return allNodes;
		return allNodes.filter(
			({ node, isRoot }) => isRoot || fuzzyMatch(searchQuery, node),
		);
	}, [allNodes, searchQuery]);

	// Determine if search should be shown (>10 projects)
	const showSearch = allNodes.length > 10;

	// Pre-select current directory on mount
	useEffect(() => {
		const index = filteredNodes.findIndex(
			({ node }) => node.path === currentDir,
		);
		if (index >= 0) {
			setSelectedIndex(index);
		}
	}, [currentDir, filteredNodes]);

	// Keep selected index in bounds when filter changes
	useEffect(() => {
		if (selectedIndex >= filteredNodes.length) {
			setSelectedIndex(Math.max(0, filteredNodes.length - 1));
		}
	}, [filteredNodes.length, selectedIndex]);

	// Handle keyboard input
	useInput(
		useCallback(
			(input, key) => {
				// Navigation
				if (key.upArrow) {
					setSelectedIndex((prev) =>
						prev > 0 ? prev - 1 : filteredNodes.length - 1,
					);
					return;
				}
				if (key.downArrow) {
					setSelectedIndex((prev) =>
						prev < filteredNodes.length - 1 ? prev + 1 : 0,
					);
					return;
				}

				// Page Up - jump to start (Ctrl+A or 'g' in search mode off)
				if (key.pageUp || (input === "a" && key.ctrl)) {
					setSelectedIndex(0);
					return;
				}

				// Page Down - jump to end (Ctrl+E or 'G' in search mode off)
				if (key.pageDown || (input === "e" && key.ctrl)) {
					setSelectedIndex(filteredNodes.length - 1);
					return;
				}

				// Selection
				if (key.return) {
					const selected = filteredNodes[selectedIndex];
					if (selected) {
						onSelect(selected.node.path);
					}
					return;
				}

				// Cancel
				if (key.escape) {
					onCancel();
					return;
				}

				// Clear search with Ctrl+U
				if (input === "u" && key.ctrl) {
					setSearchQuery("");
					setSelectedIndex(0);
					return;
				}

				// Backspace - remove from search
				if (key.backspace || key.delete) {
					setSearchQuery((prev) => prev.slice(0, -1));
					return;
				}

				// Type to filter - printable characters only
				if (input && input.length === 1 && !key.ctrl && !key.meta) {
					setSearchQuery((prev) => prev + input);
					setSelectedIndex(0);
				}
			},
			[filteredNodes, selectedIndex, onSelect, onCancel],
		),
	);

	// Get the currently selected node
	const selectedNode = filteredNodes[selectedIndex];

	return (
		<Box flexDirection="column" marginTop={spacing.small}>
			{/* Header */}
			<Box marginBottom={spacing.small}>
				<Text color={colors.info}>{figures.questionMarkPrefix} </Text>
				<Text bold>Select a project to initialize rp1:</Text>
			</Box>

			{/* Monorepo type indicator */}
			<Box marginBottom={spacing.small} marginLeft={spacing.medium}>
				<Text color={colors.dim}>
					[{getMonorepoTypeLabel(monorepoType)} detected at {monorepoRoot}]
				</Text>
			</Box>

			{/* Search input (shown when >10 projects) */}
			{showSearch && (
				<Box marginBottom={spacing.small} marginLeft={spacing.medium}>
					<Text color={colors.accent}>Search: </Text>
					<Text>{searchQuery}</Text>
					<Text color={colors.dim}>_</Text>
				</Box>
			)}

			{/* Match count when searching */}
			{searchQuery && (
				<Box marginBottom={spacing.small} marginLeft={spacing.medium}>
					<Text color={colors.dim}>
						Showing {filteredNodes.length} of {allNodes.length} projects
					</Text>
				</Box>
			)}

			{/* Project list */}
			<Box
				flexDirection="column"
				marginLeft={spacing.medium}
				marginBottom={spacing.small}
			>
				{filteredNodes.map(({ node, isRoot }, index) => {
					const isSelected = index === selectedIndex;
					const pointer = isSelected ? figures.pointer : " ";
					const indicator = getMarkerIndicator(node.type, isRoot);

					// Determine if this is a recommended choice
					const isRecommended = !isRoot && node.depth === 1;
					const isNotRecommended = isRoot;

					// Tree indentation
					const indent = "  ".repeat(node.depth);

					return (
						<Box key={node.path}>
							<Text color={isSelected ? colors.accent : colors.dim}>
								{pointer}{" "}
							</Text>
							<Text color={colors.dim}>{indent}</Text>
							<Text
								color={
									isRoot
										? colors.warning
										: isSelected
											? colors.accent
											: undefined
								}
							>
								{indicator}
							</Text>
							<Text> </Text>
							<Text
								bold={isSelected}
								color={isSelected ? undefined : colors.dim}
							>
								{isRoot ? "(monorepo root)" : node.relativePath}
							</Text>

							{/* Recommendation badges */}
							{isRecommended && (
								<Text color={colors.success}> (recommended)</Text>
							)}
							{isNotRecommended && (
								<Text color={colors.warning}> (not recommended)</Text>
							)}

							{/* rp1 initialized indicator */}
							{node.hasRp1 && (
								<Text color={colors.info}> [rp1 initialized]</Text>
							)}
						</Box>
					);
				})}
			</Box>

			{/* Selected path info */}
			{selectedNode && (
				<Box marginLeft={spacing.medium} marginBottom={spacing.small}>
					<Text color={colors.dim}>
						Selected:{" "}
						{selectedNode.isRoot
							? monorepoRoot
							: selectedNode.node.relativePath}
					</Text>
				</Box>
			)}

			{/* Help text */}
			<Box marginLeft={spacing.medium}>
				<Text color={colors.dim}>
					{showSearch ? "Type to filter, " : ""}
					{figures.arrowUp}/{figures.arrowDown} navigate, Enter select, Esc
					cancel
				</Text>
			</Box>
		</Box>
	);
};

export default ProjectTree;
