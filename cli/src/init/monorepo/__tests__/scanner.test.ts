/**
 * Unit tests for project scanner.
 * Focus: Glob resolution, tree building, marker detection, and exclusions.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { MonorepoDetectionResult, ProjectMarker } from "../models.js";
import {
	buildProjectTree,
	detectProjectMarker,
	resolveGlobPatterns,
	scanProjects,
} from "../scanner.js";

let tempDir: string;

beforeAll(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-tests-"));
});

afterAll(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("resolveGlobPatterns", () => {
	it("resolves workspace patterns and excludes node_modules/target/dist", async () => {
		const testDir = path.join(tempDir, "glob-exclusions");
		await fs.mkdir(path.join(testDir, "packages", "core"), { recursive: true });
		await fs.mkdir(path.join(testDir, "packages", "node_modules"), {
			recursive: true,
		});
		await fs.mkdir(path.join(testDir, "packages", "target"), {
			recursive: true,
		});
		await fs.mkdir(path.join(testDir, "packages", "dist"), { recursive: true });

		const result = await resolveGlobPatterns(testDir, ["packages/*"])();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toContain(path.join(testDir, "packages", "core"));
			expect(result.right).not.toContain(
				path.join(testDir, "packages", "node_modules"),
			);
			expect(result.right).not.toContain(
				path.join(testDir, "packages", "target"),
			);
			expect(result.right).not.toContain(
				path.join(testDir, "packages", "dist"),
			);
		}
	});
});

describe("detectProjectMarker", () => {
	it("detects project markers in priority order", async () => {
		const markers: Array<{
			file: string;
			content: string;
			expected: ProjectMarker;
		}> = [
			{ file: "package.json", content: "{}", expected: "package.json" },
			{
				file: "Cargo.toml",
				content: '[package]\nname = "x"',
				expected: "Cargo.toml",
			},
			{ file: "go.mod", content: "module test", expected: "go.mod" },
			{ file: "pom.xml", content: "<project/>", expected: "pom.xml" },
			{ file: "build.gradle", content: "plugins {}", expected: "build.gradle" },
			{ file: "MyProject.csproj", content: "<Project/>", expected: "csproj" },
		];

		for (const { file, content, expected } of markers) {
			const testDir = path.join(
				tempDir,
				`marker-${expected.replace(".", "-")}`,
			);
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, file), content);

			const result = await detectProjectMarker(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right).toBe(expected);
			}
		}
	});

	it("returns 'directory' when no marker found", async () => {
		const testDir = path.join(tempDir, "no-marker");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(path.join(testDir, "README.md"), "# Test");

		const result = await detectProjectMarker(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right).toBe("directory");
		}
	});
});

describe("buildProjectTree", () => {
	it("builds hierarchical tree with correct depth and .rp1 detection", async () => {
		const testDir = path.join(tempDir, "tree-test");
		await fs.mkdir(path.join(testDir, "packages", "core", ".rp1"), {
			recursive: true,
		});
		await fs.mkdir(path.join(testDir, "packages", "utils"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(testDir, "packages", "core", "package.json"),
			"{}",
		);
		await fs.writeFile(
			path.join(testDir, "packages", "utils", "package.json"),
			"{}",
		);

		const projectPaths = [
			path.join(testDir, "packages", "core"),
			path.join(testDir, "packages", "utils"),
		];

		const result = await buildProjectTree(testDir, projectPaths)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.length).toBe(2);

			const core = result.right.find((n) => n.name === "core");
			const utils = result.right.find((n) => n.name === "utils");

			expect(core?.hasRp1).toBe(true);
			expect(core?.depth).toBe(2);
			expect(core?.relativePath).toBe("packages/core");

			expect(utils?.hasRp1).toBe(false);
			expect(utils?.depth).toBe(2);
		}
	});
});

describe("scanProjects", () => {
	it("scans projects from detection result with multiple glob patterns", async () => {
		const testDir = path.join(tempDir, "scan-full");
		await fs.mkdir(path.join(testDir, "packages", "core"), { recursive: true });
		await fs.mkdir(path.join(testDir, "apps", "web"), { recursive: true });
		await fs.writeFile(
			path.join(testDir, "packages", "core", "package.json"),
			"{}",
		);
		await fs.writeFile(path.join(testDir, "apps", "web", "package.json"), "{}");

		const detection: MonorepoDetectionResult = {
			detected: true,
			type: "npm-workspaces",
			rootPath: testDir,
			configFile: "package.json",
			workspaceGlobs: ["packages/*", "apps/*"],
		};

		const result = await scanProjects(detection)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			const names = result.right.map((n) => n.name);
			expect(names).toContain("core");
			expect(names).toContain("web");
		}
	});
});
