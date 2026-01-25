/**
 * Maven multi-module project configuration parser.
 * Parses pom.xml to extract modules section for multi-module project detection.
 */

import * as path from "node:path";
import * as TE from "fp-ts/lib/TaskEither.js";

/**
 * Result of parsing Maven project configuration.
 */
export interface MavenProjectResult {
	/** Whether this is a multi-module Maven project */
	readonly hasModules: boolean;
	/** Paths to module directories */
	readonly modulePaths: readonly string[];
	/** The artifact ID of the parent project */
	readonly artifactId: string | null;
}

/**
 * Parses pom.xml to extract module paths for multi-module projects.
 *
 * Expected format:
 * ```xml
 * <project>
 *   <artifactId>parent-project</artifactId>
 *   <modules>
 *     <module>module1</module>
 *     <module>module2</module>
 *     <module>nested/module3</module>
 *   </modules>
 * </project>
 * ```
 *
 * @param rootPath - Absolute path to the directory containing pom.xml
 * @returns TaskEither with parsed project result, never fails
 */
export const parseMavenProject = (
	rootPath: string,
): TE.TaskEither<never, MavenProjectResult> =>
	TE.tryCatch(
		async () => {
			const pomPath = path.join(rootPath, "pom.xml");
			const file = Bun.file(pomPath);

			if (!(await file.exists())) {
				return {
					hasModules: false,
					modulePaths: [],
					artifactId: null,
				};
			}

			const content = await file.text();

			// Extract artifact ID
			const artifactId = extractXmlElement(content, "artifactId");

			// Extract modules section
			const modulePaths = extractModules(content);

			return {
				hasModules: modulePaths.length > 0,
				modulePaths,
				artifactId,
			};
		},
		// Never fails - all errors return empty result
		() =>
			({
				hasModules: false,
				modulePaths: [],
				artifactId: null,
			}) as never,
	);

/**
 * Extracts the text content of an XML element using regex.
 * Only extracts the first occurrence and only at the top level
 * (not nested within other complex elements).
 *
 * @param content - The XML content
 * @param elementName - The name of the element to extract
 * @returns The text content or null if not found
 */
function extractXmlElement(
	content: string,
	elementName: string,
): string | null {
	// Match <elementName>content</elementName>
	// Only match if it's a simple text element (no nested elements)
	const regex = new RegExp(`<${elementName}>([^<]+)</${elementName}>`, "i");
	const match = content.match(regex);
	return match?.[1]?.trim() ?? null;
}

/**
 * Extracts module paths from the <modules> section of pom.xml.
 *
 * @param content - The pom.xml content
 * @returns Array of module paths
 */
function extractModules(content: string): string[] {
	const modules: string[] = [];

	// Match the <modules>...</modules> section
	const modulesRegex = /<modules>([\s\S]*?)<\/modules>/i;
	const modulesMatch = content.match(modulesRegex);

	if (!modulesMatch?.[1]) {
		return modules;
	}

	const modulesContent = modulesMatch[1];

	// Extract each <module>path</module> entry
	const moduleRegex = /<module>([^<]+)<\/module>/gi;
	let moduleMatch: RegExpExecArray | null;

	while ((moduleMatch = moduleRegex.exec(modulesContent)) !== null) {
		if (moduleMatch[1]) {
			const modulePath = moduleMatch[1].trim();
			if (modulePath) {
				modules.push(modulePath);
			}
		}
	}

	return modules;
}
