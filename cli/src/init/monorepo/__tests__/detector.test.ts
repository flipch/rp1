/**
 * Unit tests for monorepo detection logic.
 * Focus: Detection correctness for each monorepo type and priority ordering.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { detectMonorepo } from "../detector.js";

let tempDir: string;

beforeAll(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "detector-tests-"));
});

afterAll(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("detectMonorepo", () => {
	describe("workspace detection by type", () => {
		it("detects npm workspaces from package.json", async () => {
			const testDir = path.join(tempDir, "npm-workspaces");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({
					name: "test-monorepo",
					workspaces: ["packages/*", "apps/*"],
				}),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("npm-workspaces");
				expect(result.right.workspaceGlobs).toEqual(["packages/*", "apps/*"]);
			}
		});

		it("detects pnpm workspaces from pnpm-workspace.yaml", async () => {
			const testDir = path.join(tempDir, "pnpm-workspaces");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "pnpm-workspace.yaml"),
				"packages:\n  - 'packages/*'\n  - 'apps/*'\n",
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("pnpm-workspaces");
			}
		});

		it("detects Cargo workspace from Cargo.toml [workspace] section", async () => {
			const testDir = path.join(tempDir, "cargo-workspaces");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "Cargo.toml"),
				`[package]\nname = "my-workspace"\n\n[workspace]\nmembers = ["crates/core", "crates/cli"]\n`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("cargo-workspaces");
				expect(result.right.workspaceGlobs).toContain("crates/core");
			}
		});

		it("detects Gradle multi-project from settings.gradle", async () => {
			const testDir = path.join(tempDir, "gradle-multiproject");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "settings.gradle"),
				"rootProject.name = 'my-project'\ninclude 'app'\ninclude ':core'\n",
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("gradle-multiproject");
			}
		});

		it("detects Maven multi-module from pom.xml", async () => {
			const testDir = path.join(tempDir, "maven-multimodule");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "pom.xml"),
				`<?xml version="1.0"?>\n<project>\n<modules>\n<module>core</module>\n<module>api</module>\n</modules>\n</project>`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("maven-multimodule");
				expect(result.right.workspaceGlobs).toContain("core");
			}
		});

		it("detects .NET solution from .sln file", async () => {
			const testDir = path.join(tempDir, "dotnet-solution");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "MySolution.sln"),
				`Microsoft Visual Studio Solution File\nProject("{FAE04EC0}") = "WebApp", "src\\WebApp.csproj", "{GUID1}"\nEndProject\n`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("dotnet-solution");
			}
		});
	});

	describe("detection priority", () => {
		it("tool-based configs take priority over workspace-based", async () => {
			const testDir = path.join(tempDir, "turbo-priority");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "turbo.json"), "{}");
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({ name: "test", workspaces: ["packages/*"] }),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).toBe("turborepo");
			}
		});

		it("pnpm workspaces takes priority over npm workspaces", async () => {
			const testDir = path.join(tempDir, "pnpm-priority");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "pnpm-workspace.yaml"),
				"packages:\n  - 'packages/*'\n",
			);
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({ name: "test", workspaces: ["packages/*"] }),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).toBe("pnpm-workspaces");
			}
		});
	});

	describe("non-monorepo handling", () => {
		it("returns detected=false for single-project package.json", async () => {
			const testDir = path.join(tempDir, "single-project");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({ name: "simple", version: "1.0.0" }),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(false);
				expect(result.right.type).toBe(null);
			}
		});

		it("handles malformed config files gracefully", async () => {
			const testDir = path.join(tempDir, "malformed");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "package.json"), "{ invalid }");

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(false);
			}
		});
	});
});
