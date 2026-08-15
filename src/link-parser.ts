/**
 * Pure link parsing utilities that can be tested independently of Obsidian
 */

import { VideoLinkDetails } from "./types";
import { DEFAULT_TIMESTAMP } from "./constants";

// Regex to match all video link formats:
// [[id#video:path#timestamp]]                              - Standard
// [[id#video:path#timestamp#]]                             - Fixed timestamp
// [[id#video:path#timestamp#hash:abc123]]                  - With hash
// [[id#video:path#timestamp##hash:abc123]]                 - Fixed + hash
// [[id#video:path#timestamp#hash:abc123#size:12345]]       - With hash and size
// [[id#video:path#timestamp##hash:abc123#size:12345]]      - Fixed + hash + size
export const VIDEO_LINK_REGEX = /\[\[\d*#video:.*?#\d\d:\d\d:\d\d(?:#)?(?:#hash:[a-f0-9]+)?(?:#size:\d+)?]]/g;

/**
 * Extracts video details from a formatted video link string
 * @param input - The video link string in format [[id#video:path#timestamp(#)(#hash:...)(#size:...)]]
 * @returns Object containing filepath, timestamp, isFixed flag, optional hash, and optional size
 */
export function extractDetails(input: string): VideoLinkDetails {
	const videoLinkRegex = /\[\[\d+#video:(.+?)#(\d\d:\d\d:\d\d)(#)?(?:#hash:([a-f0-9]+))?(?:#size:(\d+))?]]/;
	const match = input.match(videoLinkRegex);

	if (match && match[1] && match[2]) {
		return {
			filepath: match[1],
			timestamp: match[2],
			isFixed: !!match[3],
			hash: match[4],
			size: match[5] ? parseInt(match[5], 10) : undefined
		};
	}
	return { filepath: "/", timestamp: DEFAULT_TIMESTAMP, isFixed: false };
}

/**
 * Determines if a video link has a fixed timestamp
 * Fixed timestamps are marked with an extra # at the end and won't be updated
 * @param originalLink - The video link string to check
 * @returns Boolean indicating if the timestamp is fixed
 */
export function isLinkFixed(originalLink: string): boolean {
	// Match #timestamp# where the second # is NOT the start of #hash:
	// Uses negative lookahead (?!hash:) to exclude hash suffix
	const timestampEndRegex = /#\d\d:\d\d:\d\d#(?!hash:)/;
	return timestampEndRegex.test(originalLink);
}

/**
 * Timestamp info extracted from MPV output
 */
export interface TimestampInfo {
	timestamp: string;
	duration?: string;
}

/**
 * Converts a timestamp string (HH:MM:SS) to total seconds
 * @param timestamp - Timestamp in format HH:MM:SS
 * @returns Total seconds
 */
export function timestampToSeconds(timestamp: string): number {
	const parts = timestamp.split(':').map(Number);
	if (parts.length !== 3) return 0;
	const [hours, minutes, seconds] = parts;
	const result = (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
	return isNaN(result) ? 0 : result;
}

/**
 * Converts total seconds to a timestamp string (HH:MM:SS)
 * @param totalSeconds - Total seconds
 * @returns Timestamp in format HH:MM:SS
 */
export function secondsToTimestamp(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Extracts timestamp and duration from MPV player's stdout output
 * @param stdout - The standard output from the MPV process
 * @returns Object containing timestamp and optional duration
 */
/**
 * A timestamp is only usable when minutes and seconds are real clock values
 * (0-59). Hours are unbounded — long recordings can exceed 24 h.
 */
function hasValidMinutesAndSeconds(ts: string): boolean {
	const parts = ts.split(':');
	if (parts.length !== 3) return false;
	const minutes = parseInt(parts[1] ?? '', 10);
	const seconds = parseInt(parts[2] ?? '', 10);
	return minutes < 60 && seconds < 60;
}

export function extractTimestampInfo(stdout: string): TimestampInfo {
	const timeRegex = /\[ (\d{2}:\d{2}:\d{2}) \/ (\d{2}:\d{2}:\d{2}) ]/;
	const match = stdout.match(timeRegex);
	if (match?.[1] && match?.[2]) {
		const timestamp = match[1];
		const duration = match[2];
		if (hasValidMinutesAndSeconds(timestamp) && hasValidMinutesAndSeconds(duration)) {
			return { timestamp, duration };
		}
	}
	return { timestamp: DEFAULT_TIMESTAMP };
}

/**
 * Extracts the last timestamp from MPV player's stdout output
 * @param stdout - The standard output from the MPV process
 * @returns The extracted timestamp in format HH:MM:SS or default timestamp if not found
 * @deprecated Use extractTimestampInfo instead
 */
export function extractLastTimestamp(stdout: string): string {
	return extractTimestampInfo(stdout).timestamp;
}

/**
 * Extracts the timestamp from a video button's text
 * @param buttonText - The button text containing video link information
 * @returns The timestamp in format HH:MM:SS with any # characters removed
 */
export function getStartTimestampFromText(buttonText: string): string {
	return buttonText.split("/")[1]?.replace(/#/g, "") ?? DEFAULT_TIMESTAMP;
}

/**
 * Replaces the playback timestamp inside a video link string.
 * Targets only the structural timestamp (the `#HH:MM:SS` that is followed by
 * `#` or `]`), so a timestamp-like substring that appears inside the file
 * path is not touched.
 *
 * @param originalLink - Full video link, e.g. `[[id#video:path#01:23:45]]`
 * @param newTimestamp - Replacement timestamp, e.g. `"02:34:56"`
 * @returns Link with the structural timestamp replaced
 */
export function replaceTimestampInLink(originalLink: string, newTimestamp: string): string {
	// Match #HH:MM:SS only when followed by # or ] — this is the structural
	// timestamp position and excludes identical substrings in the file path.
	return originalLink.replace(/#\d{2}:\d{2}:\d{2}(?=#|])/, `#${newTimestamp}`);
}

/**
 * Extracts the basename (filename) from a video link's filepath.
 * Handles both slash styles so Unix and Windows paths behave the same.
 */
function linkFileName(link: string): string {
	const filepath = extractDetails(link).filepath;
	return filepath.split(/[/\\]/).pop() ?? "";
}

/**
 * A line that contains a video link, i.e. a line we care to reorder.
 */
function isVideoLinkLine(line: string): boolean {
	return line.match(VIDEO_LINK_REGEX) !== null;
}

/**
 * Sorts an array of video links by the filename of the referenced video,
 * case-insensitively. Returns a new array; the input is not modified.
 */
export function sortLinksByFileName(links: readonly string[]): string[] {
	return [...links].sort((a, b) => {
		const nameA = linkFileName(a).toLowerCase();
		const nameB = linkFileName(b).toLowerCase();
		return nameA.localeCompare(nameB);
	});
}

/**
 * Sorts the video-link lines of a raw mpv_link block body, leaving any
 * non-link lines (blank lines, stray text) in their original positions.
 */
function sortVideoLinkLines(inner: string): string {
	const lines = inner.split("\n");
	const sortedLinkLines = sortLinksByFileName(lines.filter(isVideoLinkLine));

	// Rebuild line by line: link lines come back in sorted order, everything
	// else is repeated unchanged.
	const reordered: string[] = [];
	let nextSortedLink = 0;
	for (const line of lines) {
		if (!isVideoLinkLine(line)) {
			reordered.push(line);
		} else {
			reordered.push(sortedLinkLines[nextSortedLink] ?? line);
			nextSortedLink++;
		}
	}
	return reordered.join("\n");
}

/**
 * Sorts the links inside a matched mpv_link block, keeping its fences and any
 * surrounding whitespace exactly as they were.
 */
function sortLinksInBlock(blockMatch: string, inner: string): string {
	const innerStart = blockMatch.indexOf(inner);
	const blockPrefix = blockMatch.slice(0, innerStart);
	const blockSuffix = blockMatch.slice(innerStart + inner.length);
	return blockPrefix + sortVideoLinkLines(inner) + blockSuffix;
}

/**
 * Rewrites `content` so every mpv_link fenced block is reordered by the
 * filename of the video in its first link (case-insensitive, basename only),
 * and the links inside each block are sorted by filename too. The text between
 * blocks stays where it is — only the blocks move.
 * @param content - Full markdown document text
 * @returns Content with mpv_link blocks sorted by filename
 */
export function sortMpvLinkBlocksByFileName(content: string): string {
	const codeBlockRegex = /```\s*mpv_link\s*\n([\s\S]*?)```/g;

	// Slice the document into blocks and the text between them; the gaps keep
	// their slots later so reordering blocks never drags surrounding prose.
	const blocks: string[] = [];
	const textBeforeEachBlock: string[] = [];
	let matchEnd = 0;
	let match: RegExpExecArray | null;
	while ((match = codeBlockRegex.exec(content)) !== null) {
		textBeforeEachBlock.push(content.slice(matchEnd, match.index));
		blocks.push(sortLinksInBlock(match[0], match[1] ?? ""));
		matchEnd = match.index + match[0].length;
	}
	textBeforeEachBlock.push(content.slice(matchEnd));

	const firstLinkFileName = (block: string): string => {
		const firstLink = block.match(VIDEO_LINK_REGEX)?.[0];
		return firstLink ? linkFileName(firstLink).toLowerCase() : "";
	};
	blocks.sort((a, b) => firstLinkFileName(a).localeCompare(firstLinkFileName(b)));

	// Reassemble: block N is preceded by the text gap that sat before it in
	// the document, and the last gap is whatever followed the final block.
	let sortedContent = "";
	blocks.forEach((block, index) => {
		sortedContent += textBeforeEachBlock[index] ?? "";
		sortedContent += block;
	});
	return sortedContent + (textBeforeEachBlock[blocks.length] ?? "");
}

/**
 * Replaces every occurrence of `originalLink` inside `content` with `newLink`.
 * Uses split/join instead of String.replace so that all occurrences are
 * updated and no regex interpretation of special characters takes place.
 *
 * @param content      - Full markdown document text
 * @param originalLink - The exact link string to find
 * @param newLink      - The replacement link string
 * @returns Updated content with all occurrences replaced
 */
export function replaceAllLinkOccurrences(content: string, originalLink: string, newLink: string): string {
	// split/join replaces every occurrence without regex interpretation of
	// special characters (brackets, dots, etc.) in the link string.
	return content.split(originalLink).join(newLink);
}
