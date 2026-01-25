/**
 * Unit tests for CLAUDE.md/AGENTS.md directive handling.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ensureDirectives } from "../directives.js";
import { CLAUDE_CODE_TEMPLATE } from "../templates/claude-code.js";

let tempDir: string;

beforeAll(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "directives-tests-"));
});

afterAll(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("ensureDirectives", () => {
	describe("creates CLAUDE.md if neither exists", () => {
		it("creates CLAUDE.md with directives when no directive file exists", async () => {
			const testDir = path.join(tempDir, "create-claude");
			await fs.mkdir(testDir, { recursive: true });

			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.file).toBe("CLAUDE.md");
				expect(result.right.action).toBe("created");
			}

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(content).toContain("<!-- rp1:start -->");
			expect(content).toContain("<!-- rp1:end -->");
			expect(content).toContain("## rp1 Knowledge Base");
			expect(content).toContain("index.md");
		});

		it("created CLAUDE.md contains Progressive Disclosure Pattern format", async () => {
			const testDir = path.join(tempDir, "progressive-disclosure");
			await fs.mkdir(testDir, { recursive: true });

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			// Check for Progressive Disclosure Pattern content
			expect(content).toContain("architecture.md");
			expect(content).toContain("modules.md");
			expect(content).toContain("patterns.md");
			expect(content).toContain("code review");
			expect(content).toContain("bugs");
		});
	});

	describe("appends to existing CLAUDE.md", () => {
		it("appends directives to existing CLAUDE.md without markers", async () => {
			const testDir = path.join(tempDir, "append-claude");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# My Project

This is my CLAUDE.md file with custom content.

## Custom Section
Some custom instructions here.
`;
			await fs.writeFile(path.join(testDir, "CLAUDE.md"), existingContent);

			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.file).toBe("CLAUDE.md");
				expect(result.right.action).toBe("appended");
			}

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			// Should preserve existing content
			expect(content).toContain("# My Project");
			expect(content).toContain("## Custom Section");
			expect(content).toContain("Some custom instructions here.");
			// Should append rp1 directives
			expect(content).toContain("<!-- rp1:start -->");
			expect(content).toContain("<!-- rp1:end -->");
			expect(content).toContain("## rp1 Knowledge Base");
		});
	});

	describe("appends to AGENTS.md (priority over CLAUDE.md)", () => {
		it("uses AGENTS.md when it exists (priority over CLAUDE.md)", async () => {
			const testDir = path.join(tempDir, "agents-priority");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "AGENTS.md"),
				"# My Agents\n\nAgent instructions.\n",
			);
			await fs.writeFile(
				path.join(testDir, "CLAUDE.md"),
				"# My Claude\n\nClaude instructions.\n",
			);

			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.file).toBe("AGENTS.md");
			}

			// AGENTS.md should be modified
			const agentsContent = await fs.readFile(
				path.join(testDir, "AGENTS.md"),
				"utf-8",
			);
			expect(agentsContent).toContain("<!-- rp1:start -->");
			expect(agentsContent).toContain("## rp1 Knowledge Base");

			// CLAUDE.md should be unchanged
			const claudeContent = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(claudeContent).not.toContain("<!-- rp1:start -->");
		});

		it("appends to AGENTS.md without markers", async () => {
			const testDir = path.join(tempDir, "append-agents");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# Agents Guide

Custom agent instructions.
`;
			await fs.writeFile(path.join(testDir, "AGENTS.md"), existingContent);

			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.file).toBe("AGENTS.md");
				expect(result.right.action).toBe("appended");
			}

			const content = await fs.readFile(
				path.join(testDir, "AGENTS.md"),
				"utf-8",
			);
			expect(content).toContain("# Agents Guide");
			expect(content).toContain("Custom agent instructions.");
			expect(content).toContain("<!-- rp1:start -->");
		});
	});

	describe("updates existing directives between markers", () => {
		it("updates content between markers when different", async () => {
			const testDir = path.join(tempDir, "update-markers");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# My Project

<!-- rp1:start -->
## Old rp1 content
This is outdated.
<!-- rp1:end -->

## Footer
`;
			await fs.writeFile(path.join(testDir, "CLAUDE.md"), existingContent);

			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.action).toBe("updated");
			}

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			// Old content should be replaced
			expect(content).not.toContain("## Old rp1 content");
			expect(content).not.toContain("This is outdated.");
			// New content should be present
			expect(content).toContain("## rp1 Knowledge Base");
			expect(content).toContain("index.md");
		});

		it("is idempotent when content is already correct", async () => {
			const testDir = path.join(tempDir, "idempotent-markers");
			await fs.mkdir(testDir, { recursive: true });

			// First call - create file
			await ensureDirectives(testDir)();
			const firstContent = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);

			// Second call - should not change content
			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.action).toBe("updated");
			}

			const secondContent = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(secondContent).toBe(firstContent);
		});

		it("does not duplicate markers on repeated calls", async () => {
			const testDir = path.join(tempDir, "no-dup-markers");
			await fs.mkdir(testDir, { recursive: true });

			// Multiple calls
			await ensureDirectives(testDir)();
			await ensureDirectives(testDir)();
			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			const startCount = (content.match(/<!-- rp1:start -->/g) || []).length;
			const endCount = (content.match(/<!-- rp1:end -->/g) || []).length;
			expect(startCount).toBe(1);
			expect(endCount).toBe(1);
		});
	});

	describe("preserves content outside markers", () => {
		it("preserves content before markers", async () => {
			const testDir = path.join(tempDir, "preserve-before");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# My Project

This is important content that should not be modified.

## Custom Instructions
1. Do this
2. Do that

<!-- rp1:start -->
old content
<!-- rp1:end -->
`;
			await fs.writeFile(path.join(testDir, "CLAUDE.md"), existingContent);

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(content).toContain("# My Project");
			expect(content).toContain(
				"This is important content that should not be modified.",
			);
			expect(content).toContain("## Custom Instructions");
			expect(content).toContain("1. Do this");
		});

		it("preserves content after markers", async () => {
			const testDir = path.join(tempDir, "preserve-after");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `<!-- rp1:start -->
old content
<!-- rp1:end -->

## Additional Notes
This comes after the rp1 section.

## Another Section
More content here.
`;
			await fs.writeFile(path.join(testDir, "CLAUDE.md"), existingContent);

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(content).toContain("## Additional Notes");
			expect(content).toContain("This comes after the rp1 section.");
			expect(content).toContain("## Another Section");
		});

		it("preserves content both before and after markers", async () => {
			const testDir = path.join(tempDir, "preserve-both");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# Header

Intro content.

<!-- rp1:start -->
placeholder
<!-- rp1:end -->

## Footer
Footer content.
`;
			await fs.writeFile(path.join(testDir, "CLAUDE.md"), existingContent);

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(content).toContain("# Header");
			expect(content).toContain("Intro content.");
			expect(content).toContain("## Footer");
			expect(content).toContain("Footer content.");
			expect(content).toContain("## rp1 Knowledge Base");
		});
	});

	describe("uses Progressive Disclosure Pattern format", () => {
		it("includes KB file references", async () => {
			const testDir = path.join(tempDir, "kb-references");
			await fs.mkdir(testDir, { recursive: true });

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(content).toContain("index.md");
			expect(content).toContain("architecture.md");
			expect(content).toContain("modules.md");
			expect(content).toContain("patterns.md");
		});

		it("includes loading instructions based on task type", async () => {
			const testDir = path.join(tempDir, "loading-instructions");
			await fs.mkdir(testDir, { recursive: true });

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			// Should contain task-based loading guidance
			expect(content).toContain("code review");
			expect(content).toContain("patterns.md");
		});

		it("matches the CLAUDE_CODE_TEMPLATE content", async () => {
			const testDir = path.join(tempDir, "template-match");
			await fs.mkdir(testDir, { recursive: true });

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			// The template content should be present between markers
			expect(content).toContain(CLAUDE_CODE_TEMPLATE.trim());
		});
	});

	describe("handles edge cases", () => {
		it("handles empty CLAUDE.md", async () => {
			const testDir = path.join(tempDir, "empty-claude");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "CLAUDE.md"), "");

			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");
			if (result._tag === "Right") {
				expect(result.right.action).toBe("appended");
			}

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			expect(content).toContain("<!-- rp1:start -->");
		});

		it("handles AGENTS.md with only whitespace", async () => {
			const testDir = path.join(tempDir, "whitespace-agents");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, "AGENTS.md"), "   \n\n  ");

			const result = await ensureDirectives(testDir)();
			expect(result._tag).toBe("Right");

			const content = await fs.readFile(
				path.join(testDir, "AGENTS.md"),
				"utf-8",
			);
			expect(content).toContain("<!-- rp1:start -->");
		});

		it("appends with blank line separator to non-empty file", async () => {
			const testDir = path.join(tempDir, "blank-separator");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, "CLAUDE.md"),
				"# My Project\nSome content",
			);

			await ensureDirectives(testDir)();

			const content = await fs.readFile(
				path.join(testDir, "CLAUDE.md"),
				"utf-8",
			);
			// Should have blank line before rp1 section
			expect(content).toMatch(/Some content\n\n<!-- rp1:start -->/);
		});
	});
});
