/**
 * Integration tests for monorepo detection and project scanning.
 * Focus: End-to-end flows, multi-root support, performance.
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

let tempDir: string;

beforeEach(async () => {
	tempDir = await createTempDir("monorepo-integration-");
});

afterEach(async () => {
	await cleanupTempDir(tempDir);
});

describe("integration: end-to-end monorepo detection and scanning", () => {
	test("npm workspaces: detect -> scan -> verify projects", async () => {
		await writeFixture(
			tempDir,
			"package.json",
			JSON.stringify({
				name: "npm-workspaces-monorepo",
				private: true,
				workspaces: ["packages/*", "apps/*"],
			}),
		);
		await writeFixture(
			tempDir,
			"packages/core/package.json",
			JSON.stringify({ name: "@test/core" }),
		);
		await writeFixture(
			tempDir,
			"packages/utils/package.json",
			JSON.stringify({ name: "@test/utils" }),
		);
		await writeFixture(
			tempDir,
			"apps/web/package.json",
			JSON.stringify({ name: "@test/web" }),
		);

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		expect(detectResult.right.detected).toBe(true);
		expect(detectResult.right.type).toBe("npm-workspaces");

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag !== "Right") return;

		const paths = scanResult.right.map((p) => p.relativePath);
		expect(paths).toContain("packages/core");
		expect(paths).toContain("packages/utils");
		expect(paths).toContain("apps/web");

		// Verify project properties
		for (const project of scanResult.right) {
			expect(project.type).toBe("package.json");
			expect(project.depth).toBe(2);
		}
	});

	test("Turborepo takes priority over npm workspaces", async () => {
		await writeFixture(
			tempDir,
			"package.json",
			JSON.stringify({
				name: "turborepo-monorepo",
				workspaces: ["packages/*"],
			}),
		);
		await writeFixture(
			tempDir,
			"turbo.json",
			JSON.stringify({ tasks: { build: {} } }),
		);
		await writeFixture(
			tempDir,
			"packages/ui/package.json",
			JSON.stringify({ name: "@test/ui" }),
		);

		const result = await detectMonorepo(tempDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.type).toBe("turborepo");
		}
	});
});

describe("integration: multi-root .rp1/ support (REQ-005)", () => {
	test("detects multiple independent .rp1/ directories", async () => {
		await writeFixture(
			tempDir,
			"package.json",
			JSON.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
		);
		await writeFixture(
			tempDir,
			"packages/core/package.json",
			JSON.stringify({ name: "@test/core" }),
		);
		await writeFixture(
			tempDir,
			"packages/utils/package.json",
			JSON.stringify({ name: "@test/utils" }),
		);

		// Create .rp1 in multiple packages with different content
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

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag !== "Right") return;

		const coreProject = scanResult.right.find(
			(p) => p.relativePath === "packages/core",
		);
		const utilsProject = scanResult.right.find(
			(p) => p.relativePath === "packages/utils",
		);

		expect(coreProject?.hasRp1).toBe(true);
		expect(utilsProject?.hasRp1).toBe(true);

		// Verify content is independent
		const coreKB = await Bun.file(
			join(tempDir, "packages/core/.rp1/context/index.md"),
		).text();
		const utilsKB = await Bun.file(
			join(tempDir, "packages/utils/.rp1/context/index.md"),
		).text();
		expect(coreKB).toContain("Core KB");
		expect(utilsKB).toContain("Utils KB");
	});
});

describe("integration: non-monorepo fallback (REQ-007)", () => {
	test("single-project repos return detected=false", async () => {
		await writeFixture(
			tempDir,
			"package.json",
			JSON.stringify({ name: "single-project", version: "1.0.0" }),
		);

		const result = await detectMonorepo(tempDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.detected).toBe(false);
			expect(result.right.type).toBeNull();
		}
	});
});

describe("integration: performance (NFR 6.1)", () => {
	test(
		"detection completes under 2s for 50+ packages",
		async () => {
			await writeFixture(
				tempDir,
				"package.json",
				JSON.stringify({
					name: "large-monorepo",
					workspaces: ["packages/*"],
				}),
			);

			for (let i = 0; i < 50; i++) {
				await writeFixture(
					tempDir,
					`packages/pkg-${i.toString().padStart(2, "0")}/package.json`,
					JSON.stringify({ name: `@test/pkg-${i}` }),
				);
			}

			const start = performance.now();
			const detectResult = await detectMonorepo(tempDir)();
			expect(detectResult._tag).toBe("Right");
			if (detectResult._tag !== "Right") return;

			const scanResult = await scanProjects(detectResult.right)();
			expect(scanResult._tag).toBe("Right");
			const duration = performance.now() - start;

			expect(duration).toBeLessThan(2000);
			if (scanResult._tag === "Right") {
				expect(scanResult.right.length).toBeGreaterThanOrEqual(50);
			}
		},
		{ timeout: 10000 },
	);
});

describe("integration: edge cases", () => {
	test("handles malformed package.json gracefully", async () => {
		await writeFixture(tempDir, "package.json", "{ invalid }");

		const result = await detectMonorepo(tempDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.detected).toBe(false);
		}
	});

	test("excludes node_modules from scanning", async () => {
		await writeFixture(
			tempDir,
			"package.json",
			JSON.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
		);
		await writeFixture(
			tempDir,
			"packages/core/package.json",
			JSON.stringify({ name: "@test/core" }),
		);
		await writeFixture(
			tempDir,
			"node_modules/dep/package.json",
			JSON.stringify({ name: "dep" }),
		);

		const detectResult = await detectMonorepo(tempDir)();
		expect(detectResult._tag).toBe("Right");
		if (detectResult._tag !== "Right") return;

		const scanResult = await scanProjects(detectResult.right)();
		expect(scanResult._tag).toBe("Right");
		if (scanResult._tag !== "Right") return;

		const paths = scanResult.right.map((p) => p.relativePath);
		expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
	});
});
