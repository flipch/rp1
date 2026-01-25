/**
 * Unit tests for workspace configuration parsers.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseCargoWorkspace } from "../cargo-workspace.js";
import { parseDotnetSolution } from "../dotnet-solution.js";
import { scanGoModules } from "../go-modules.js";
import { parseGradleProject } from "../gradle-project.js";
import { parseMavenProject } from "../maven-project.js";
import { parseNpmWorkspace } from "../npm-workspace.js";
import { parsePnpmWorkspace } from "../pnpm-workspace.js";

// Utility to create temp directory for tests
let tempDir: string;

beforeAll(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "parser-tests-"));
});

afterAll(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("parseNpmWorkspace", () => {
	it("returns empty result when package.json does not exist", async () => {
		const testDir = path.join(tempDir, "npm-empty");
		await fs.mkdir(testDir, { recursive: true });

		const result = await parseNpmWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspaces).toBe(false);
			expect(result.right.workspaceGlobs).toEqual([]);
		}
	});

	it("parses package.json with array workspaces", async () => {
		const testDir = path.join(tempDir, "npm-array");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "package.json"),
			JSON.stringify({
				name: "test-monorepo",
				workspaces: ["packages/*", "apps/*"],
			}),
		);

		const result = await parseNpmWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspaces).toBe(true);
			expect(result.right.workspaceGlobs).toEqual(["packages/*", "apps/*"]);
			expect(result.right.isYarn).toBe(false);
		}
	});

	it("parses package.json with object workspaces (Yarn)", async () => {
		const testDir = path.join(tempDir, "npm-yarn");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "package.json"),
			JSON.stringify({
				name: "test-monorepo",
				workspaces: {
					packages: ["packages/*"],
					nohoist: ["**/react-native"],
				},
			}),
		);
		await fs.writeFile(path.join(testDir, "yarn.lock"), "# yarn lockfile v1");

		const result = await parseNpmWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspaces).toBe(true);
			expect(result.right.workspaceGlobs).toEqual(["packages/*"]);
			expect(result.right.isYarn).toBe(true);
		}
	});

	it("handles malformed package.json gracefully", async () => {
		const testDir = path.join(tempDir, "npm-malformed");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(path.join(testDir, "package.json"), "{ invalid json");

		const result = await parseNpmWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspaces).toBe(false);
		}
	});
});

describe("parsePnpmWorkspace", () => {
	it("returns empty result when pnpm-workspace.yaml does not exist", async () => {
		const testDir = path.join(tempDir, "pnpm-empty");
		await fs.mkdir(testDir, { recursive: true });

		const result = await parsePnpmWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspaces).toBe(false);
		}
	});

	it("parses pnpm-workspace.yaml packages field", async () => {
		const testDir = path.join(tempDir, "pnpm-valid");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "pnpm-workspace.yaml"),
			`packages:
  - 'packages/*'
  - 'apps/*'
  - '!**/test/**'
`,
		);

		const result = await parsePnpmWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspaces).toBe(true);
			// Negation patterns should be filtered out
			expect(result.right.workspaceGlobs).toEqual(["packages/*", "apps/*"]);
		}
	});
});

describe("parseCargoWorkspace", () => {
	it("returns empty result when Cargo.toml does not exist", async () => {
		const testDir = path.join(tempDir, "cargo-empty");
		await fs.mkdir(testDir, { recursive: true });

		const result = await parseCargoWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspace).toBe(false);
		}
	});

	it("parses Cargo.toml with workspace members", async () => {
		const testDir = path.join(tempDir, "cargo-valid");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "Cargo.toml"),
			`[package]
name = "test"
version = "0.1.0"

[workspace]
members = [
    "crates/core",
    "crates/cli",
]
exclude = ["crates/experimental"]
`,
		);

		const result = await parseCargoWorkspace(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasWorkspace).toBe(true);
			expect(result.right.workspaceMembers).toEqual([
				"crates/core",
				"crates/cli",
			]);
			expect(result.right.excludePatterns).toEqual(["crates/experimental"]);
		}
	});
});

describe("scanGoModules", () => {
	it("returns empty result when no go.mod files exist", async () => {
		const testDir = path.join(tempDir, "go-empty");
		await fs.mkdir(testDir, { recursive: true });

		const result = await scanGoModules(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasMultipleModules).toBe(false);
			expect(result.right.modulePaths).toEqual([]);
		}
	});

	it("detects multiple go.mod files", async () => {
		const testDir = path.join(tempDir, "go-multi");
		await fs.mkdir(path.join(testDir, "pkg1"), { recursive: true });
		await fs.mkdir(path.join(testDir, "pkg2"), { recursive: true });
		await fs.writeFile(path.join(testDir, "go.mod"), "module main");
		await fs.writeFile(
			path.join(testDir, "pkg1", "go.mod"),
			"module main/pkg1",
		);
		await fs.writeFile(
			path.join(testDir, "pkg2", "go.mod"),
			"module main/pkg2",
		);

		const result = await scanGoModules(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasMultipleModules).toBe(true);
			expect(result.right.modulePaths.length).toBeGreaterThan(1);
		}
	});

	it("parses go.work file", async () => {
		const testDir = path.join(tempDir, "go-work");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "go.work"),
			`go 1.18

use (
    ./cmd
    ./pkg
)
`,
		);

		const result = await scanGoModules(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasGoWork).toBe(true);
			expect(result.right.modulePaths).toContain("cmd");
			expect(result.right.modulePaths).toContain("pkg");
		}
	});
});

describe("parseGradleProject", () => {
	it("returns empty result when settings.gradle does not exist", async () => {
		const testDir = path.join(tempDir, "gradle-empty");
		await fs.mkdir(testDir, { recursive: true });

		const result = await parseGradleProject(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasMultiProject).toBe(false);
		}
	});

	it("parses settings.gradle with include statements", async () => {
		const testDir = path.join(tempDir, "gradle-valid");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "settings.gradle"),
			`rootProject.name = 'my-project'
include 'app'
include ':core'
include ':nested:module'
`,
		);

		const result = await parseGradleProject(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasMultiProject).toBe(true);
			expect(result.right.projectPaths).toContain("app");
			expect(result.right.projectPaths).toContain("core");
			expect(result.right.projectPaths).toContain("nested/module");
		}
	});

	it("parses settings.gradle.kts (Kotlin DSL)", async () => {
		const testDir = path.join(tempDir, "gradle-kotlin");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "settings.gradle.kts"),
			`rootProject.name = "my-project"
include("app", "core")
include(":library")
`,
		);

		const result = await parseGradleProject(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasMultiProject).toBe(true);
			expect(result.right.isKotlinDsl).toBe(true);
		}
	});
});

describe("parseMavenProject", () => {
	it("returns empty result when pom.xml does not exist", async () => {
		const testDir = path.join(tempDir, "maven-empty");
		await fs.mkdir(testDir, { recursive: true });

		const result = await parseMavenProject(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasModules).toBe(false);
		}
	});

	it("parses pom.xml with modules", async () => {
		const testDir = path.join(tempDir, "maven-valid");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "pom.xml"),
			`<?xml version="1.0" encoding="UTF-8"?>
<project>
    <artifactId>parent</artifactId>
    <modules>
        <module>core</module>
        <module>api</module>
        <module>web</module>
    </modules>
</project>
`,
		);

		const result = await parseMavenProject(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasModules).toBe(true);
			expect(result.right.modulePaths).toEqual(["core", "api", "web"]);
			expect(result.right.artifactId).toBe("parent");
		}
	});
});

describe("parseDotnetSolution", () => {
	it("returns empty result when no .sln files exist", async () => {
		const testDir = path.join(tempDir, "dotnet-empty");
		await fs.mkdir(testDir, { recursive: true });

		const result = await parseDotnetSolution(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasProjects).toBe(false);
		}
	});

	it("parses .sln file with projects", async () => {
		const testDir = path.join(tempDir, "dotnet-valid");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "MySolution.sln"),
			`Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApp", "src\\WebApp\\WebApp.csproj", "{GUID1}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "src\\Core\\Core.csproj", "{GUID2}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{GUID3}"
EndProject
`,
		);

		const result = await parseDotnetSolution(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.hasProjects).toBe(true);
			expect(result.right.solutionName).toBe("MySolution");
			expect(result.right.projectPaths).toContain("src/WebApp");
			expect(result.right.projectPaths).toContain("src/Core");
			// Solution folders should be excluded
			expect(result.right.projectPaths).not.toContain("Solution Items");
		}
	});
});
