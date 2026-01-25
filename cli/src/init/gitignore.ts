/**
 * Gitignore management with marker-based updates.
 * Uses `# rp1:start` and `# rp1:end` markers to identify managed sections.
 */

import path from "node:path";
import { pipe } from "fp-ts/lib/function.js";
import * as TE from "fp-ts/lib/TaskEither.js";

const START_MARKER = "# rp1:start";
const END_MARKER = "# rp1:end";

/**
 * Entries to add to .gitignore for rp1.
 * These are the default entries that ignore generated content but preserve config.
 */
const RP1_GITIGNORE_ENTRIES = [
	"# rp1 generated files",
	".rp1/work/",
	".rp1/context/",
	"!.rp1/config.yaml",
];

/**
 * Position of the rp1 managed section in the gitignore file.
 */
interface FencePosition {
	readonly start: number;
	readonly end: number;
	readonly startMarkerEnd: number;
	readonly endMarkerStart: number;
}

/**
 * Find the rp1 managed section in gitignore content.
 */
function findFencedContent(content: string): FencePosition | null {
	const startIdx = content.indexOf(START_MARKER);
	if (startIdx === -1) return null;

	const endIdx = content.indexOf(END_MARKER, startIdx);
	if (endIdx === -1) return null;

	return {
		start: startIdx,
		end: endIdx + END_MARKER.length,
		startMarkerEnd: startIdx + START_MARKER.length,
		endMarkerStart: endIdx,
	};
}

/**
 * Generate the managed section content.
 */
function generateManagedSection(): string {
	return [START_MARKER, ...RP1_GITIGNORE_ENTRIES, END_MARKER].join("\n");
}

/**
 * Extract content between markers (for comparison).
 */
function extractFencedContent(content: string): string | null {
	const position = findFencedContent(content);
	if (!position) return null;
	return content.slice(position.startMarkerEnd, position.endMarkerStart).trim();
}

/**
 * Replace the managed section with new content.
 */
function replaceFencedContent(
	content: string,
	newFencedContent: string,
): string {
	const position = findFencedContent(content);

	if (!position) {
		return appendFencedContent(content, newFencedContent);
	}

	const before = content.slice(0, position.start);
	const after = content.slice(position.end);

	return before + newFencedContent + after;
}

/**
 * Append the managed section to the end of the file.
 */
function appendFencedContent(
	content: string,
	newFencedContent: string,
): string {
	const trimmed = content.trimEnd();
	const separator = trimmed.length > 0 ? "\n\n" : "";
	return `${trimmed}${separator}${newFencedContent}\n`;
}

/**
 * Read file contents, returning empty string if file doesn't exist.
 */
const readFileText = (filePath: string): TE.TaskEither<Error, string> =>
	TE.tryCatch(
		async () => {
			const file = Bun.file(filePath);
			if (!(await file.exists())) return "";
			return file.text();
		},
		(e) => new Error(`Failed to read ${filePath}: ${String(e)}`),
	);

/**
 * Write content to a file.
 */
const writeFile = (
	filePath: string,
	content: string,
): TE.TaskEither<Error, void> =>
	TE.tryCatch(
		async () => {
			await Bun.write(filePath, content);
		},
		(e) => new Error(`Failed to write ${filePath}: ${String(e)}`),
	);

/**
 * Ensure .gitignore exists with rp1 managed section.
 *
 * Behavior:
 * - If .gitignore doesn't exist: creates it with rp1 entries
 * - If markers exist: compares content, updates if different
 * - If no markers: appends managed section at end
 * - Always preserves user content outside markers
 *
 * @param targetDir - Directory where .gitignore should be managed
 * @returns TaskEither that resolves to void on success
 */
export const ensureGitignore = (
	targetDir: string,
): TE.TaskEither<Error, void> => {
	const gitignorePath = path.join(targetDir, ".gitignore");
	const expectedEntries = RP1_GITIGNORE_ENTRIES.join("\n");

	return pipe(
		readFileText(gitignorePath),
		TE.chain((existingContent) => {
			const managedSection = generateManagedSection();

			// File doesn't exist or is empty - create new
			if (existingContent === "") {
				return writeFile(gitignorePath, `${managedSection}\n`);
			}

			// Check if markers exist
			const existingEntries = extractFencedContent(existingContent);

			if (existingEntries !== null) {
				// Markers exist - compare and update if different
				if (existingEntries === expectedEntries) {
					// Content is the same, no update needed
					return TE.right(undefined);
				}
				// Update the managed section
				const updatedContent = replaceFencedContent(
					existingContent,
					managedSection,
				);
				return writeFile(gitignorePath, updatedContent);
			}

			// No markers - append managed section
			const updatedContent = appendFencedContent(
				existingContent,
				managedSection,
			);
			return writeFile(gitignorePath, updatedContent);
		}),
	);
};
