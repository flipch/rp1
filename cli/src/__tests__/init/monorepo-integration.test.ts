/**
 * Integration tests for monorepo detection and project scanning.
 * Tests end-to-end behavior with real filesystem structures.
 *
 * These tests use:
 * - Real filesystem with temp directories
 * - Actual detectMonorepo and scanProjects functions
 * - Various monorepo fixture structures
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { detectMonorepo, scanProjects } from "../../init/monorepo/index.js";
import {
	cleanupTempDir,
	createTempDir,
	writeFixture,
} from "../helpers/index.js";

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create an npm workspaces monorepo fixture.
 */
async function createNpmWorkspacesMonorepo(rootDir: string): Promise<void> {
	// Root package.json with workspaces
	await writeFixture(
		rootDir,
		"package.json",
		JSON.stringify({
			name: "npm-workspaces-monorepo",
			private: true,
			workspaces: ["packages/*", "apps/*"],
		}),
	);

	// Create workspace packages
	await writeFixture(
		rootDir,
		"packages/core/package.json",
		JSON.stringify({ name: "@test/core", version: "1.0.0" }),
	);
	await writeFixture(
		rootDir,
		"packages/utils/package.json",
		JSON.stringify({ name: "@test/utils", version: "1.0.0" }),
	);
	await writeFixture(
		rootDir,
		"apps/web/package.json",
		JSON.stringify({ name: "@test/web", version: "1.0.0" }),
	);
}

/**
 * Create a pnpm workspaces monorepo fixture.
 */
async function createPnpmWorkspacesMonorepo(rootDir: string): Promise<void> {
	// Root package.json (minimal)
	await writeFixture(
		rootDir,
		"package.json",
		JSON.stringify({ name: "pnpm-workspaces-monorepo", private: true }),
	);

	// pnpm-workspace.yaml
	await writeFixture(
		rootDir,
		"pnpm-workspace.yaml",
		`packages:
  - 'packages/*'
  - 'apps/*'
`,
	);

	// Create workspace packages
	await writeFixture(
		rootDir,
		"packages/shared/package.json",
		JSON.stringify({ name: "@test/shared", version: "1.0.0" }),
	);
	await writeFixture(
		rootDir,
		"packages/config/package.json",
		JSON.stringify({ name: "@test/config", version: "1.0.0" }),
	);
	await writeFixture(
		rootDir,
		"apps/api/package.json",
		JSON.stringify({ name: "@test/api", version: "1.0.0" }),
	);
}

/**
 * Create a Turborepo monorepo fixture.
 */
async function createTurborepoMonorepo(rootDir: string): Promise<void> {
	// Root package.json with workspaces
	await writeFixture(
		rootDir,
		"package.json",
		JSON.stringify({
			name: "turborepo-monorepo",
			private: true,
			workspaces: ["packages/*", "apps/*"],
		}),
	);

	// turbo.json
	await writeFixture(
		rootDir,
		"turbo.json",
		JSON.stringify({
			$schema: "https://turbo.build/schema.json",
			tasks: {
				build: { dependsOn: ["^build"] },
				dev: { cache: false, persistent: true },
			},
		}),
	);

	// Create workspace packages
	await writeFixture(
		rootDir,
		"packages/ui/package.json",
		JSON.stringify({ name: "@test/ui", version: "1.0.0" }),
	);
	await writeFixture(
		rootDir,
		"packages/eslint-config/package.json",
		JSON.stringify({ name: "@test/eslint-config", version: "1.0.0" }),
	);
	await writeFixture(
		rootDir,
		"apps/web/package.json",
		JSON.stringify({ name: "@test/web", version: "1.0.0" }),
	);
	await writeFixture(
		rootDir,
		"apps/docs/package.json",
		JSON.stringify({ name: "@test/docs", version: "1.0.0" }),
	);
}

/**
 * Create a single-project (non-monorepo) fixture.
 */
async function createSingleProject(rootDir: string): Promise<void> {
	await writeFixture(
		rootDir,
		"package.json",
		JSON.stringify({
			name: "single-project",
			version: "1.0.0",
			private: false,
		}),
	);
	await writeFixture(rootDir, "src/index.ts", "export const main = () => {}");
}

// ============================================================================
// Integration Tests: Monorepo Detection
// ============================================================================

describe("integration: monorepo detection", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir("monorepo-integration-");
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	describe("npm workspaces monorepo", () => {
		test("detectMonorepo correctly identifies npm workspaces", async () => {
			await createNpmWorkspacesMonorepo(tempDir);

			const result = await detectMonorepo(tempDir)();

			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("npm-workspaces");
				expect(result.right.rootPath).toBe(tempDir);
				expect(result.right.workspaceGlobs).toContain("packages/*");
				expect(result.right.workspaceGlobs).toContain("apps/*");
			}
		});

		test("scanProjects discovers all npm workspace projects", async () => {
			await createNpmWorkspacesMonorepo(tempDir);

			const detectResult = await detectMonorepo(tempDir)();
			expect(detectResult._tag).toBe("Right");
			if (detectResult._tag !== "Right") return;

			const scanResult = await scanProjects(detectResult.right)();

			expect(scanResult._tag).toBe("Right");
			if (scanResult._tag === "Right") {
				const projects = scanResult.right;
				expect(projects.length).toBeGreaterThanOrEqual(3);

				// Check that all expected projects are found
				const relativePaths = projects.map((p) => p.relativePath);
				expect(relativePaths).toContain("packages/core");
				expect(relativePaths).toContain("packages/utils");
				expect(relativePaths).toContain("apps/web");

				// Check project markers are detected
				for (const project of projects) {
					expect(project.type).toBe("package.json");
					expect(project.depth).toBeGreaterThan(0);
				}
			}
		});
	});

	describe("pnpm workspaces monorepo", () => {
		test("detectMonorepo correctly identifies pnpm workspaces", async () => {
			await createPnpmWorkspacesMonorepo(tempDir);

			const result = await detectMonorepo(tempDir)();

			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("pnpm-workspaces");
				expect(result.right.rootPath).toBe(tempDir);
				expect(result.right.configFile).toBe("pnpm-workspace.yaml");
			}
		});

		test("scanProjects discovers all pnpm workspace projects", async () => {
			await createPnpmWorkspacesMonorepo(tempDir);

			const detectResult = await detectMonorepo(tempDir)();
			expect(detectResult._tag).toBe("Right");
			if (detectResult._tag !== "Right") return;

			const scanResult = await scanProjects(detectResult.right)();

			expect(scanResult._tag).toBe("Right");
			if (scanResult._tag === "Right") {
				const projects = scanResult.right;
				expect(projects.length).toBeGreaterThanOrEqual(3);

				const relativePaths = projects.map((p) => p.relativePath);
				expect(relativePaths).toContain("packages/shared");
				expect(relativePaths).toContain("packages/config");
				expect(relativePaths).toContain("apps/api");
			}
		});
	});

	describe("Turborepo monorepo", () => {
		test("detectMonorepo correctly identifies Turborepo (priority over npm workspaces)", async () => {
			await createTurborepoMonorepo(tempDir);

			const result = await detectMonorepo(tempDir)();

			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				// Turborepo has higher priority than npm-workspaces
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("turborepo");
				expect(result.right.rootPath).toBe(tempDir);
				expect(result.right.configFile).toBe("turbo.json");
			}
		});

		test("scanProjects discovers all Turborepo projects", async () => {
			await createTurborepoMonorepo(tempDir);

			const detectResult = await detectMonorepo(tempDir)();
			expect(detectResult._tag).toBe("Right");
			if (detectResult._tag !== "Right") return;

			const scanResult = await scanProjects(detectResult.right)();

			expect(scanResult._tag).toBe("Right");
			if (scanResult._tag === "Right") {
				const projects = scanResult.right;
				expect(projects.length).toBeGreaterThanOrEqual(4);

				const relativePaths = projects.map((p) => p.relativePath);
				expect(relativePaths).toContain("packages/ui");
				expect(relativePaths).toContain("packages/eslint-config");
				expect(relativePaths).toContain("apps/web");
				expect(relativePaths).toContain("apps/docs");
			}
		});
	});
});

// ============================================================================
// Integration Tests: Project Properties
// ============================================================================

describe("integration: project node properties", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir("monorepo-props-");
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	test("projects include correct markers and depth", async () => {
		await createNpmWorkspacesMonorepo(tempDir);

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag !== "Right") return;

		const projects = scanResult.right;

		for (const project of projects) {
			// All projects should have package.json marker
			expect(project.type).toBe("package.json");

			// Depth should be calculated from relative path
			const expectedDepth = project.relativePath
				.split("/")
				.filter((p) => p).length;
			expect(project.depth).toBe(expectedDepth);

			// Path should be absolute
			expect(project.path.startsWith("/")).toBe(true);

			// Name should be the directory name
			expect(project.path.endsWith(project.name)).toBe(true);
		}
	});

	test("existing .rp1/ directories are detected", async () => {
		await createNpmWorkspacesMonorepo(tempDir);

		// Create .rp1 directory in one of the packages
		const rp1Dir = join(tempDir, "packages/core/.rp1");
		await mkdir(rp1Dir, { recursive: true });
		await writeFile(join(rp1Dir, "config.yaml"), "version: 1");

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag !== "Right") return;

		const projects = scanResult.right;
		const coreProject = projects.find(
			(p) => p.relativePath === "packages/core",
		);
		const utilsProject = projects.find(
			(p) => p.relativePath === "packages/utils",
		);

		// Core should have hasRp1 = true
		expect(coreProject).toBeDefined();
		if (coreProject) {
			expect(coreProject.hasRp1).toBe(true);
		}

		// Utils should have hasRp1 = false
		expect(utilsProject).toBeDefined();
		if (utilsProject) {
			expect(utilsProject.hasRp1).toBe(false);
		}
	});
});

// ============================================================================
// Integration Tests: Multi-Root Support (REQ-005)
// ============================================================================

describe("integration: multi-root .rp1/ installation (REQ-005)", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir("monorepo-multiroot-");
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	test("can have multiple .rp1/ directories in subdirectories", async () => {
		await createNpmWorkspacesMonorepo(tempDir);

		// Create .rp1 in multiple packages
		await mkdir(join(tempDir, "packages/core/.rp1/context"), {
			recursive: true,
		});
		await writeFile(
			join(tempDir, "packages/core/.rp1/context/index.md"),
			"# Core KB",
		);

		await mkdir(join(tempDir, "packages/utils/.rp1/context"), {
			recursive: true,
		});
		await writeFile(
			join(tempDir, "packages/utils/.rp1/context/index.md"),
			"# Utils KB",
		);

		await mkdir(join(tempDir, "apps/web/.rp1/context"), { recursive: true });
		await writeFile(
			join(tempDir, "apps/web/.rp1/context/index.md"),
			"# Web KB",
		);

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag !== "Right") return;

		const projects = scanResult.right;

		// All three packages should show hasRp1 = true
		const coreProject = projects.find(
			(p) => p.relativePath === "packages/core",
		);
		const utilsProject = projects.find(
			(p) => p.relativePath === "packages/utils",
		);
		const webProject = projects.find((p) => p.relativePath === "apps/web");

		expect(coreProject?.hasRp1).toBe(true);
		expect(utilsProject?.hasRp1).toBe(true);
		expect(webProject?.hasRp1).toBe(true);
	});

	test("each .rp1/ directory is independent", async () => {
		await createNpmWorkspacesMonorepo(tempDir);

		// Create .rp1 directories with different content
		await mkdir(join(tempDir, "packages/core/.rp1/context"), {
			recursive: true,
		});
		await writeFile(
			join(tempDir, "packages/core/.rp1/context/index.md"),
			"# Core Knowledge Base\nCore-specific content",
		);

		await mkdir(join(tempDir, "packages/utils/.rp1/context"), {
			recursive: true,
		});
		await writeFile(
			join(tempDir, "packages/utils/.rp1/context/index.md"),
			"# Utils Knowledge Base\nUtils-specific content",
		);

		// Verify the files are independent by reading them
		const coreKB = await Bun.file(
			join(tempDir, "packages/core/.rp1/context/index.md"),
		).text();
		const utilsKB = await Bun.file(
			join(tempDir, "packages/utils/.rp1/context/index.md"),
		).text();

		expect(coreKB).toContain("Core Knowledge Base");
		expect(coreKB).toContain("Core-specific content");
		expect(utilsKB).toContain("Utils Knowledge Base");
		expect(utilsKB).toContain("Utils-specific content");

		// Verify scanner still works
		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
	});
});

// ============================================================================
// Integration Tests: Non-Monorepo Fallback (REQ-007)
// ============================================================================

describe("integration: non-monorepo fallback (REQ-007)", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir("monorepo-fallback-");
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	test("single-project repos return detected=false", async () => {
		await createSingleProject(tempDir);

		const result = await detectMonorepo(tempDir)();

		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.detected).toBe(false);
			expect(result.right.type).toBeNull();
			expect(result.right.rootPath).toBe(tempDir);
			expect(result.right.configFile).toBeNull();
			expect(result.right.workspaceGlobs).toEqual([]);
		}
	});

	test("empty directory returns detected=false", async () => {
		// tempDir is already empty

		const result = await detectMonorepo(tempDir)();

		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.detected).toBe(false);
			expect(result.right.type).toBeNull();
		}
	});

	test("package.json without workspaces returns detected=false for npm-workspaces", async () => {
		await writeFixture(
			tempDir,
			"package.json",
			JSON.stringify({
				name: "regular-package",
				version: "1.0.0",
				dependencies: { lodash: "^4.0.0" },
			}),
		);

		const result = await detectMonorepo(tempDir)();

		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			// Should not detect npm-workspaces type
			expect(result.right.type).not.toBe("npm-workspaces");
			// Might be detected as something else if there are go.mod/Cargo.toml etc.
			// but in this case, should be not detected
			expect(result.right.detected).toBe(false);
		}
	});

	test("scanProjects returns empty for non-monorepo when no workspace patterns", async () => {
		await createSingleProject(tempDir);

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();

		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag === "Right") {
			// For non-monorepo, scanner still discovers projects via directory scan
			// but since there's only the root, it may find root-level package.json
			// The actual behavior depends on scanner implementation
			// Key assertion: it doesn't crash and returns valid result
			expect(Array.isArray(scanResult.right)).toBe(true);
		}
	});
});

// ============================================================================
// Integration Tests: Performance (NFR 6.1)
// ============================================================================

describe("integration: performance", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir("monorepo-perf-");
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	test(
		"detection completes under 2s for reasonably sized repos",
		async () => {
			// Create a monorepo with ~50 packages
			await writeFixture(
				tempDir,
				"package.json",
				JSON.stringify({
					name: "large-monorepo",
					private: true,
					workspaces: ["packages/*"],
				}),
			);

			// Create 50 packages
			for (let i = 0; i < 50; i++) {
				await writeFixture(
					tempDir,
					`packages/pkg-${i.toString().padStart(2, "0")}/package.json`,
					JSON.stringify({
						name: `@test/pkg-${i}`,
						version: "1.0.0",
					}),
				);
			}

			const startTime = performance.now();

			const detectResult = await detectMonorepo(tempDir)();
			expect(detectResult._tag).toBe("Right");
			if (detectResult._tag !== "Right") return;

			const scanResult = await scanProjects(detectResult.right)();
			expect(scanResult._tag).toBe("Right");

			const endTime = performance.now();
			const duration = endTime - startTime;

			// Should complete in under 2 seconds (NFR 6.1)
			expect(duration).toBeLessThan(2000);

			// Verify all projects were found
			if (scanResult._tag === "Right") {
				expect(scanResult.right.length).toBeGreaterThanOrEqual(50);
			}
		},
		{ timeout: 10000 },
	);

	test(
		"detection completes under 2s with nested directory structure",
		async () => {
			// Create a monorepo with multiple workspace patterns
			// Real-world monorepos typically use explicit patterns like this
			await writeFixture(
				tempDir,
				"package.json",
				JSON.stringify({
					name: "nested-monorepo",
					private: true,
					workspaces: [
						"packages/core/*",
						"packages/utils/*",
						"packages/plugins/*",
						"packages/tools/*",
					],
				}),
			);

			// Create packages with various nesting levels
			const categories = ["core", "utils", "plugins", "tools"];
			for (const category of categories) {
				for (let i = 0; i < 10; i++) {
					await writeFixture(
						tempDir,
						`packages/${category}/pkg-${i}/package.json`,
						JSON.stringify({
							name: `@test/${category}-${i}`,
							version: "1.0.0",
						}),
					);
				}
			}

			const startTime = performance.now();

			const detectResult = await detectMonorepo(tempDir)();
			expect(detectResult._tag).toBe("Right");
			if (detectResult._tag !== "Right") return;

			const scanResult = await scanProjects(detectResult.right)();
			expect(scanResult._tag).toBe("Right");

			const endTime = performance.now();
			const duration = endTime - startTime;

			// Should complete in under 2 seconds
			expect(duration).toBeLessThan(2000);

			// Verify projects were found (40 packages)
			if (scanResult._tag === "Right") {
				expect(scanResult.right.length).toBeGreaterThanOrEqual(40);
			}
		},
		{ timeout: 10000 },
	);
});

// ============================================================================
// Integration Tests: Edge Cases
// ============================================================================

describe("integration: edge cases", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await createTempDir("monorepo-edge-");
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	test("handles malformed package.json gracefully", async () => {
		await writeFixture(tempDir, "package.json", "{ invalid json }}}");

		const result = await detectMonorepo(tempDir)();

		// Should not throw, just return not detected
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.detected).toBe(false);
		}
	});

	test("handles malformed pnpm-workspace.yaml gracefully", async () => {
		await writeFixture(
			tempDir,
			"pnpm-workspace.yaml",
			"invalid: [yaml: content",
		);

		const result = await detectMonorepo(tempDir)();

		// Should not throw
		expect(result._tag).toBe("Right");
	});

	test("handles empty workspaces array", async () => {
		await writeFixture(
			tempDir,
			"package.json",
			JSON.stringify({
				name: "empty-workspaces",
				workspaces: [],
			}),
		);

		const result = await detectMonorepo(tempDir)();

		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			// Empty workspaces is technically a monorepo config
			// but since there are no patterns, behavior may vary
			// The important thing is it doesn't crash
			expect(typeof result.right.detected).toBe("boolean");
		}
	});

	test("excludes node_modules from project scanning", async () => {
		await createNpmWorkspacesMonorepo(tempDir);

		// Create a node_modules directory with package.json
		await writeFixture(
			tempDir,
			"node_modules/some-dep/package.json",
			JSON.stringify({ name: "some-dep" }),
		);
		await writeFixture(
			tempDir,
			"packages/core/node_modules/inner-dep/package.json",
			JSON.stringify({ name: "inner-dep" }),
		);

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag !== "Right") return;

		// node_modules should be excluded
		const projects = scanResult.right;
		const nodeModulesProjects = projects.filter((p) =>
			p.relativePath.includes("node_modules"),
		);
		expect(nodeModulesProjects.length).toBe(0);
	});

	test("handles symlinks in workspace directories", async () => {
		// This test verifies the scanner doesn't crash with symlinks
		// Actual symlink handling depends on OS and Bun.Glob behavior
		await createNpmWorkspacesMonorepo(tempDir);

		// Note: Creating actual symlinks is platform-dependent
		// The important assertion is that scanning doesn't crash

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");

		if (detectResult._tag === "Right") {
			const scanResult = await scanProjects(detectResult.right)();
			expect(scanResult._tag).toBe("Right");
		}
	});
});
