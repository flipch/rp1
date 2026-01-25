/**
 * CLAUDE.md / AGENTS.md directive handling with marker-based updates.
 * Uses `<!-- rp1:start -->` and `<!-- rp1:end -->` markers to identify managed sections.
 */

import path from "node:path";
import { pipe } from "fp-ts/lib/function.js";
import * as TE from "fp-ts/lib/TaskEither.js";
import {
	appendFencedContent,
	extractFencedContent,
	hasFencedContent,
	replaceFencedContent,
} from "./comment-fence.js";
import { CLAUDE_CODE_TEMPLATE } from "./templates/claude-code.js";

/**
 * Result of directive management operation.
 */
export interface DirectiveResult {
	/** The file that was created or modified */
	readonly file: string;
	/** The action taken */
	readonly action: "created" | "appended" | "updated";
}

/**
 * File priority order for directive management.
 * AGENTS.md takes precedence over CLAUDE.md.
 */
const DIRECTIVE_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

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
 * Find which directive file exists in the target directory.
 * Returns the first file that exists, or null if none exist.
 */
const findExistingDirectiveFile = (
	targetDir: string,
): TE.TaskEither<Error, { fileName: string; content: string } | null> =>
	pipe(
		TE.tryCatch(
			async () => {
				for (const fileName of DIRECTIVE_FILES) {
					const filePath = path.join(targetDir, fileName);
					const file = Bun.file(filePath);
					if (await file.exists()) {
						const content = await file.text();
						return { fileName, content };
					}
				}
				return null;
			},
			(e) => new Error(`Failed to check directive files: ${String(e)}`),
		),
	);

/**
 * Ensure directives are present in CLAUDE.md or AGENTS.md.
 *
 * File priority:
 * 1. If AGENTS.md exists, use it
 * 2. If CLAUDE.md exists, use it
 * 3. If neither exists, create CLAUDE.md
 *
 * Behavior:
 * - If markers exist: compare content, update if different
 * - If no markers: append managed section at end with blank line separator
 * - Always preserves user content outside markers
 *
 * @param targetDir - Directory where directive file should be managed
 * @returns TaskEither resolving to the file and action taken
 */
export const ensureDirectives = (
	targetDir: string,
): TE.TaskEither<Error, DirectiveResult> =>
	pipe(
		findExistingDirectiveFile(targetDir),
		TE.chain((existing): TE.TaskEither<Error, DirectiveResult> => {
			// No directive file exists - create CLAUDE.md
			if (existing === null) {
				const filePath = path.join(targetDir, "CLAUDE.md");
				const content = appendFencedContent("", CLAUDE_CODE_TEMPLATE);
				return pipe(
					writeFile(filePath, content),
					TE.map(
						(): DirectiveResult => ({
							file: "CLAUDE.md",
							action: "created",
						}),
					),
				);
			}

			const { fileName, content: existingContent } = existing;
			const filePath = path.join(targetDir, fileName);

			// Check if markers already exist
			if (hasFencedContent(existingContent)) {
				const existingDirectives = extractFencedContent(existingContent);

				// Content is the same - no update needed
				if (existingDirectives === CLAUDE_CODE_TEMPLATE) {
					return TE.right({
						file: fileName,
						action: "updated",
					} as DirectiveResult);
				}

				// Update the managed section
				const updatedContent = replaceFencedContent(
					existingContent,
					CLAUDE_CODE_TEMPLATE,
				);
				return pipe(
					writeFile(filePath, updatedContent),
					TE.map(
						(): DirectiveResult => ({
							file: fileName,
							action: "updated",
						}),
					),
				);
			}

			// No markers - append managed section
			const updatedContent = appendFencedContent(
				existingContent,
				CLAUDE_CODE_TEMPLATE,
			);
			return pipe(
				writeFile(filePath, updatedContent),
				TE.map(
					(): DirectiveResult => ({
						file: fileName,
						action: "appended",
					}),
				),
			);
		}),
	);
