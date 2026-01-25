/**
 * Unit tests for CLAUDE.md/AGENTS.md directive handling.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureDirectives } from "../directives.js";

let tempDir: string;

beforeAll(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "directives-tests-"));
});

afterAll(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("ensureDirectives", () => {
	it("creates CLAUDE.md with markers when no file exists", async () => {
		const testDir = path.join(tempDir, "create-new");
		await fs.mkdir(testDir, { recursive: true });

		const result = await ensureDirectives(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.file).toBe("CLAUDE.md");
			expect(result.right.action).toBe("created");
		}

		const content = await fs.readFile(path.join(testDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("<!-- rp1:start -->");
		expect(content).toContain("<!-- rp1:end -->");
	});

	it("appends to existing CLAUDE.md", async () => {
		const testDir = path.join(tempDir, "append");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "CLAUDE.md"),
			"# My Project\n\nCustom content.\n",
		);

		const result = await ensureDirectives(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.action).toBe("appended");
		}

		const content = await fs.readFile(path.join(testDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("# My Project");
		expect(content).toContain("<!-- rp1:start -->");
	});

	it("uses AGENTS.md when it exists (priority over CLAUDE.md)", async () => {
		const testDir = path.join(tempDir, "agents-priority");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(path.join(testDir, "AGENTS.md"), "# Agents\n");
		await fs.writeFile(path.join(testDir, "CLAUDE.md"), "# Claude\n");

		const result = await ensureDirectives(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.file).toBe("AGENTS.md");
		}

		const agentsContent = await fs.readFile(
			path.join(testDir, "AGENTS.md"),
			"utf-8",
		);
		expect(agentsContent).toContain("<!-- rp1:start -->");

		const claudeContent = await fs.readFile(
			path.join(testDir, "CLAUDE.md"),
			"utf-8",
		);
		expect(claudeContent).not.toContain("<!-- rp1:start -->");
	});

	it("updates content between markers when different", async () => {
		const testDir = path.join(tempDir, "update");
		await fs.mkdir(testDir, { recursive: true });
		await fs.writeFile(
			path.join(testDir, "CLAUDE.md"),
			"# Header\n\n<!-- rp1:start -->\nold\n<!-- rp1:end -->\n",
		);

		const result = await ensureDirectives(testDir)();
		expect(result._tag).toBe("Right");
		if (result._tag === "Right") {
			expect(result.right.action).toBe("updated");
		}

		const content = await fs.readFile(path.join(testDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("# Header");
		expect(content).not.toContain("\nold\n");
	});

	it("is idempotent - no duplicate markers", async () => {
		const testDir = path.join(tempDir, "idempotent");
		await fs.mkdir(testDir, { recursive: true });

		await ensureDirectives(testDir)();
		await ensureDirectives(testDir)();
		await ensureDirectives(testDir)();

		const content = await fs.readFile(path.join(testDir, "CLAUDE.md"), "utf-8");
		const startCount = (content.match(/<!-- rp1:start -->/g) || []).length;
		const endCount = (content.match(/<!-- rp1:end -->/g) || []).length;
		expect(startCount).toBe(1);
		expect(endCount).toBe(1);
	});
});
