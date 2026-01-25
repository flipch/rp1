/**
 * Unit tests for gitignore management.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureGitignore } from "../gitignore.js";

let tempDir: string;

beforeAll(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitignore-tests-"));
});

afterAll(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("ensureGitignore", () => {
	it("creates .gitignore with markers when not exists", async () => {
		const testDir = path.join(tempDir, "create-new");
		await fs.mkdir(testDir, { recursive: true });

		const result = await ensureGitignore(testDir)();
		expect(result._tag).toBe("Right");

		const content = await fs.readFile(
			path.join(testDir, ".gitignore"),
			"utf-8",
		);
		expect(content).toContain("# rp1:start");
		expect(content).toContain("# rp1:end");
	});

	it("appends to existing .gitignore", async () => {
		const testDir = path.join(tempDir, "append");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(path.join(testDir, ".gitignore"), "node_modules/\n");

		const result = await ensureGitignore(testDir)();
		expect(result._tag).toBe("Right");

		const content = await fs.readFile(
			path.join(testDir, ".gitignore"),
			"utf-8",
		);
		expect(content).toContain("node_modules/");
		expect(content).toContain("# rp1:start");
	});

	it("updates content between markers when different", async () => {
		const testDir = path.join(tempDir, "update");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, ".gitignore"),
			"# rp1:start\nold-entry\n# rp1:end\n",
		);

		const result = await ensureGitignore(testDir)();
		expect(result._tag).toBe("Right");

		const content = await fs.readFile(
			path.join(testDir, ".gitignore"),
			"utf-8",
		);
		expect(content).not.toContain("old-entry");
		expect(content).toContain("# rp1:start");
	});

	it("is idempotent - no duplicate markers", async () => {
		const testDir = path.join(tempDir, "idempotent");
		await fs.mkdir(testDir, { recursive: true });

		await ensureGitignore(testDir)();
		await ensureGitignore(testDir)();
		await ensureGitignore(testDir)();

		const content = await fs.readFile(
			path.join(testDir, ".gitignore"),
			"utf-8",
		);
		const startCount = (content.match(/# rp1:start/g) || []).length;
		const endCount = (content.match(/# rp1:end/g) || []).length;
		expect(startCount).toBe(1);
		expect(endCount).toBe(1);
	});
});
