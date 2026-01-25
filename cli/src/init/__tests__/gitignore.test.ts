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
	describe("creates .gitignore if not exists", () => {
		it("creates new .gitignore with rp1 entries and markers", async () => {
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
			expect(content).toContain(".rp1/work/");
			expect(content).toContain(".rp1/context/");
			expect(content).toContain("!.rp1/config.yaml");
		});
	});

	describe("appends with markers to existing file", () => {
		it("appends rp1 section to existing .gitignore without markers", async () => {
			const testDir = path.join(tempDir, "append-existing");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = "node_modules/\n.env\n";
			await fs.writeFile(path.join(testDir, ".gitignore"), existingContent);

			const result = await ensureGitignore(testDir)();
			expect(result._tag).toBe("Right");

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			// Should preserve existing content
			expect(content).toContain("node_modules/");
			expect(content).toContain(".env");
			// Should add rp1 section
			expect(content).toContain("# rp1:start");
			expect(content).toContain("# rp1:end");
			expect(content).toContain(".rp1/work/");
		});

		it("appends with blank line separator", async () => {
			const testDir = path.join(tempDir, "append-separator");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, ".gitignore"),
				"node_modules/\n.env",
			);

			const result = await ensureGitignore(testDir)();
			expect(result._tag).toBe("Right");

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			// Should have blank line before rp1 section
			expect(content).toMatch(/\.env\n\n# rp1:start/);
		});
	});

	describe("updates content if markers exist and content differs", () => {
		it("updates managed section when content is different", async () => {
			const testDir = path.join(tempDir, "update-different");
			await fs.mkdir(testDir, { recursive: true });
			const oldContent = `node_modules/

# rp1:start
# old content
.rp1/old-entry/
# rp1:end

.env
`;
			await fs.writeFile(path.join(testDir, ".gitignore"), oldContent);

			const result = await ensureGitignore(testDir)();
			expect(result._tag).toBe("Right");

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			// Should preserve content outside markers
			expect(content).toContain("node_modules/");
			expect(content).toContain(".env");
			// Should update content between markers
			expect(content).not.toContain(".rp1/old-entry/");
			expect(content).toContain(".rp1/work/");
			expect(content).toContain(".rp1/context/");
		});
	});

	describe("idempotent - no duplicate entries", () => {
		it("does not modify file if content is already correct", async () => {
			const testDir = path.join(tempDir, "idempotent");
			await fs.mkdir(testDir, { recursive: true });

			// First call - create the file
			await ensureGitignore(testDir)();
			const firstContent = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);

			// Second call - should not change anything
			const result = await ensureGitignore(testDir)();
			expect(result._tag).toBe("Right");

			const secondContent = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			expect(secondContent).toBe(firstContent);
		});

		it("does not duplicate markers on repeated calls", async () => {
			const testDir = path.join(tempDir, "no-duplicate");
			await fs.mkdir(testDir, { recursive: true });

			// Multiple calls
			await ensureGitignore(testDir)();
			await ensureGitignore(testDir)();
			await ensureGitignore(testDir)();

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			const startMarkerCount = (content.match(/# rp1:start/g) || []).length;
			const endMarkerCount = (content.match(/# rp1:end/g) || []).length;
			expect(startMarkerCount).toBe(1);
			expect(endMarkerCount).toBe(1);
		});
	});

	describe("preserves user content outside markers", () => {
		it("preserves content before markers", async () => {
			const testDir = path.join(tempDir, "preserve-before");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# My custom ignores
node_modules/
.env
dist/

# rp1:start
# old content
# rp1:end
`;
			await fs.writeFile(path.join(testDir, ".gitignore"), existingContent);

			await ensureGitignore(testDir)();

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			expect(content).toContain("# My custom ignores");
			expect(content).toContain("node_modules/");
			expect(content).toContain(".env");
			expect(content).toContain("dist/");
		});

		it("preserves content after markers", async () => {
			const testDir = path.join(tempDir, "preserve-after");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# rp1:start
# old content
# rp1:end

# My footer
*.log
`;
			await fs.writeFile(path.join(testDir, ".gitignore"), existingContent);

			await ensureGitignore(testDir)();

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			expect(content).toContain("# My footer");
			expect(content).toContain("*.log");
		});

		it("preserves content both before and after markers", async () => {
			const testDir = path.join(tempDir, "preserve-both");
			await fs.mkdir(testDir, { recursive: true });
			const existingContent = `# Header comment
node_modules/

# rp1:start
# placeholder
# rp1:end

# Footer comment
*.log
`;
			await fs.writeFile(path.join(testDir, ".gitignore"), existingContent);

			await ensureGitignore(testDir)();

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			expect(content).toContain("# Header comment");
			expect(content).toContain("node_modules/");
			expect(content).toContain("# Footer comment");
			expect(content).toContain("*.log");
			// Check rp1 entries are present
			expect(content).toContain(".rp1/work/");
		});
	});

	describe("handles edge cases", () => {
		it("handles empty existing .gitignore", async () => {
			const testDir = path.join(tempDir, "empty-existing");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, ".gitignore"), "");

			const result = await ensureGitignore(testDir)();
			expect(result._tag).toBe("Right");

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			expect(content).toContain("# rp1:start");
		});

		it("handles .gitignore with only whitespace", async () => {
			const testDir = path.join(tempDir, "whitespace-only");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(path.join(testDir, ".gitignore"), "   \n\n  \n");

			const result = await ensureGitignore(testDir)();
			expect(result._tag).toBe("Right");

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			expect(content).toContain("# rp1:start");
		});

		it("handles .gitignore without trailing newline", async () => {
			const testDir = path.join(tempDir, "no-trailing-newline");
			await fs.mkdir(testDir, { recursive: true });
			await fs.writeFile(
				path.join(testDir, ".gitignore"),
				"node_modules/\n.env",
			);

			const result = await ensureGitignore(testDir)();
			expect(result._tag).toBe("Right");

			const content = await fs.readFile(
				path.join(testDir, ".gitignore"),
				"utf-8",
			);
			expect(content).toContain("# rp1:start");
			expect(content).toContain(".rp1/work/");
		});
	});
});
