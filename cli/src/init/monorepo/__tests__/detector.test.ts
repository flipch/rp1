/**
 * Unit tests for monorepo detection logic.
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
	describe("npm workspaces", () => {
		it("detects npm workspaces from package.json workspaces field", async () => {
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
				expect(result.right.rootPath).toBe(testDir);
				expect(result.right.workspaceGlobs).toEqual(["packages/*", "apps/*"]);
			}
		});

		it("returns not detected for package.json without workspaces", async () => {
			const testDir = path.join(tempDir, "npm-single");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({
					name: "single-project",
					version: "1.0.0",
				}),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(false);
				expect(result.right.type).toBe(null);
			}
		});
	});

	describe("pnpm workspaces", () => {
		it("detects pnpm workspaces from pnpm-workspace.yaml", async () => {
			const testDir = path.join(tempDir, "pnpm-workspaces");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "pnpm-workspace.yaml"),
				`packages:
  - 'packages/*'
  - 'apps/*'
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("pnpm-workspaces");
				expect(result.right.workspaceGlobs).toEqual(["packages/*", "apps/*"]);
			}
		});
	});

	describe("turborepo", () => {
		it("detects turborepo from turbo.json presence", async () => {
			const testDir = path.join(tempDir, "turborepo");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "turbo.json"),
				JSON.stringify({
					pipeline: {
						build: { dependsOn: ["^build"] },
					},
				}),
			);
			// Turborepo also needs package.json for workspace globs
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({
					name: "turbo-monorepo",
					workspaces: ["apps/*", "packages/*"],
				}),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("turborepo");
				expect(result.right.configFile).toBe("turbo.json");
			}
		});

		it("turborepo takes priority over npm workspaces", async () => {
			const testDir = path.join(tempDir, "turbo-priority");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "turbo.json"), "{}");
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({
					name: "test",
					workspaces: ["packages/*"],
				}),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).toBe("turborepo");
			}
		});
	});

	describe("cargo workspaces", () => {
		it("detects Cargo workspace from Cargo.toml with [workspace] section", async () => {
			const testDir = path.join(tempDir, "cargo-workspaces");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "Cargo.toml"),
				`[package]
name = "my-workspace"
version = "0.1.0"

[workspace]
members = [
    "crates/core",
    "crates/cli",
]
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("cargo-workspaces");
				expect(result.right.workspaceGlobs).toContain("crates/core");
				expect(result.right.workspaceGlobs).toContain("crates/cli");
			}
		});

		it("does not detect Cargo.toml without [workspace] section", async () => {
			const testDir = path.join(tempDir, "cargo-single");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "Cargo.toml"),
				`[package]
name = "single-crate"
version = "0.1.0"

[dependencies]
serde = "1.0"
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).not.toBe("cargo-workspaces");
			}
		});
	});

	describe("gradle multi-project", () => {
		it("detects Gradle multi-project from settings.gradle with include", async () => {
			const testDir = path.join(tempDir, "gradle-multiproject");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "settings.gradle"),
				`rootProject.name = 'my-project'
include 'app'
include ':core'
include ':nested:module'
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("gradle-multiproject");
			}
		});

		it("detects Gradle multi-project from settings.gradle.kts", async () => {
			const testDir = path.join(tempDir, "gradle-kotlin");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "settings.gradle.kts"),
				`rootProject.name = "my-project"
include("app", "core")
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("gradle-multiproject");
			}
		});

		it("does not detect settings.gradle without include statements", async () => {
			const testDir = path.join(tempDir, "gradle-single");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "settings.gradle"),
				`rootProject.name = 'single-project'
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).not.toBe("gradle-multiproject");
			}
		});
	});

	describe("maven multi-module", () => {
		it("detects Maven multi-module from pom.xml with modules section", async () => {
			const testDir = path.join(tempDir, "maven-multimodule");
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

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("maven-multimodule");
				expect(result.right.workspaceGlobs).toContain("core");
				expect(result.right.workspaceGlobs).toContain("api");
				expect(result.right.workspaceGlobs).toContain("web");
			}
		});

		it("does not detect pom.xml without modules section", async () => {
			const testDir = path.join(tempDir, "maven-single");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "pom.xml"),
				`<?xml version="1.0" encoding="UTF-8"?>
<project>
    <artifactId>single</artifactId>
    <version>1.0.0</version>
</project>
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).not.toBe("maven-multimodule");
			}
		});
	});

	describe("dotnet solution", () => {
		it("detects .NET solution from .sln file with projects", async () => {
			const testDir = path.join(tempDir, "dotnet-solution");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "MySolution.sln"),
				`Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApp", "src\\WebApp\\WebApp.csproj", "{GUID1}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "src\\Core\\Core.csproj", "{GUID2}"
EndProject
`,
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(true);
				expect(result.right.type).toBe("dotnet-solution");
				expect(result.right.configFile).toBe("*.sln");
			}
		});
	});

	describe("single-project returns null type", () => {
		it("returns detected: false and type: null for empty directory", async () => {
			const testDir = path.join(tempDir, "empty-project");
			await fs.mkdir(testDir, { recursive: true });

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(false);
				expect(result.right.type).toBe(null);
				expect(result.right.configFile).toBe(null);
				expect(result.right.workspaceGlobs).toEqual([]);
			}
		});

		it("returns not detected for single package.json without workspaces", async () => {
			const testDir = path.join(tempDir, "simple-npm");
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
	});

	describe("malformed config handling", () => {
		it("handles malformed package.json gracefully", async () => {
			const testDir = path.join(tempDir, "malformed-npm");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "package.json"), "{ invalid json");

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.detected).toBe(false);
			}
		});

		it("handles malformed pnpm-workspace.yaml gracefully", async () => {
			const testDir = path.join(tempDir, "malformed-pnpm");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "pnpm-workspace.yaml"),
				"invalid: yaml: content: ::::",
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			// Should still not crash, may detect or not depending on parser behavior
		});

		it("handles malformed Cargo.toml gracefully", async () => {
			const testDir = path.join(tempDir, "malformed-cargo");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "Cargo.toml"),
				"not valid toml [[[",
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			// Should not crash
		});

		it("handles empty config files gracefully", async () => {
			const testDir = path.join(tempDir, "empty-configs");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "turbo.json"), "");

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			// Should not crash
		});
	});

	describe("detection priority", () => {
		it("nx takes priority over npm workspaces", async () => {
			const testDir = path.join(tempDir, "nx-priority");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "nx.json"), "{}");
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({
					name: "test",
					workspaces: ["packages/*"],
				}),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).toBe("nx");
			}
		});

		it("lerna takes priority over npm workspaces", async () => {
			const testDir = path.join(tempDir, "lerna-priority");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "lerna.json"),
				JSON.stringify({ packages: ["packages/*"] }),
			);
			await fs.writeFile(
				path.join(testDir, "package.json"),
				JSON.stringify({
					name: "test",
					workspaces: ["packages/*"],
				}),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).toBe("lerna");
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
				JSON.stringify({
					name: "test",
					workspaces: ["packages/*"],
				}),
			);

			const result = await detectMonorepo(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.type).toBe("pnpm-workspaces");
			}
		});
	});
});
