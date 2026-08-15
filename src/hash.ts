import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { VIDEO_EXTENSIONS } from './constants';

const HASH_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

// ============================================================================
// Types
// ============================================================================

export interface DeadLinkInfo {
	originalPath: string;
	filename: string;
	hash: string;
	size?: number;
}

export interface RelocalizeProgress {
	phase: string;
	current: number;
	total: number;
	detail?: string;
}

export interface RelocalizeOptions {
	deadLinks: DeadLinkInfo[];
	searchFolder: string;
	onProgress?: (progress: RelocalizeProgress) => void;
	isCancelled?: () => boolean;
}

export interface RelocalizeResult {
	matches: Map<string, string>; // originalPath → newPath
	notFound: string[]; // originalPaths that couldn't be matched
}

/**
 * Calculates a partial MD5 hash of a file using only the first 10MB.
 * This is much faster for large video files while still being reasonably unique.
 * For files smaller than 10MB, the entire file is hashed.
 * @param filePath - Absolute path to the file
 * @returns MD5 hash as a hex string
 */
export async function calculatePartialMD5(filePath: string): Promise<string> {
	const stats = await fs.promises.stat(filePath);
	const readSize = Math.min(HASH_CHUNK_SIZE, stats.size);

	const fh = await fs.promises.open(filePath, 'r');
	const buffer = Buffer.alloc(readSize);
	try {
		await fh.read(buffer, 0, readSize, 0);
	} finally {
		await fh.close();
	}

	return crypto.createHash('md5').update(new Uint8Array(buffer)).digest('hex');
}

function isHiddenDirectory(name: string): boolean {
	return name.startsWith('.') || name === 'node_modules';
}

function isVideoFile(name: string): boolean {
	return VIDEO_EXTENSIONS.includes(path.extname(name).toLowerCase());
}

/**
 * Recursively lists every video file under a folder.
 * @param folderPath - The folder to scan
 * @returns Absolute paths to all video files found
 */
export async function scanFolderForVideos(folderPath: string): Promise<string[]> {
	const videoFiles: string[] = [];

	async function scanRecursive(dir: string): Promise<void> {
		try {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory() && !isHiddenDirectory(entry.name)) {
					await scanRecursive(fullPath);
				} else if (entry.isFile() && isVideoFile(entry.name)) {
					videoFiles.push(fullPath);
				}
			}
		} catch {
			// Unreadable folders (missing permissions) are skipped, not fatal.
			console.warn(`Could not read directory: ${dir}`);
		}
	}

	await scanRecursive(folderPath);
	return videoFiles;
}

// ============================================================================
// Tiered Relocalization
// ============================================================================

/**
 * Relocation resolving proceeds cheapest-first, so common cases avoid I/O:
 * Tier 1 — exact filename match            (map lookup, no I/O)
 * Tier 2 — matching file size              (one stat() per candidate)
 * Tier 3 — partial MD5 match               (one 10 MB read per candidate)
 * Links unresolved by these tiers fall back to a single full-scan hash map.
 */

/**
 * Reads a file's size in bytes, silently treating missing/unreadable files
 * as "no size" so they simply never match by size.
 */
async function getFileSize(filePath: string): Promise<number | undefined> {
	try {
		return (await fs.promises.stat(filePath)).size;
	} catch {
		return undefined;
	}
}

/**
 * Groups files by their basename for fast filename lookup
 * @param filePaths - Array of absolute file paths
 * @returns Map where key is lowercase filename and value is array of paths with that name
 */
function groupByFilename(filePaths: string[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();

	for (const filePath of filePaths) {
		const filename = path.basename(filePath).toLowerCase();
		const existing = groups.get(filename) || [];
		existing.push(filePath);
		groups.set(filename, existing);
	}

	return groups;
}

/**
 * The candidate files that share a dead link's filename.
 */
function filesNamed(filesByName: Map<string, string[]>, filename: string): string[] {
	return filesByName.get(filename) ?? [];
}

/**
 * Tier 2: keep only the candidates whose size matches the dead link's size.
 */
async function filesOfSize(filePaths: string[], expectedSize: number): Promise<string[]> {
	const matching: string[] = [];
	for (const filePath of filePaths) {
		if ((await getFileSize(filePath)) === expectedSize) {
			matching.push(filePath);
		}
	}
	return matching;
}

/**
 * Tier 3: the first candidate whose partial MD5 matches the recorded hash.
 */
async function matchingHash(filePaths: string[], expectedHash: string): Promise<string | undefined> {
	for (const filePath of filePaths) {
		try {
			if ((await calculatePartialMD5(filePath)) === expectedHash) {
				return filePath;
			}
		} catch {
			// An unreadable file can never be verified, so it can never match.
		}
	}
	return undefined;
}

/**
 * Resolves a single dead link against the scanned file index using the three
 * cheap tiers. Returns the relocated absolute path, or undefined when no
 * candidate passes.
 */
async function matchLink(link: DeadLinkInfo, filesByName: Map<string, string[]>): Promise<string | undefined> {
	const candidates = filesNamed(filesByName, path.basename(link.originalPath).toLowerCase());
	if (candidates.length === 0) {
		return undefined;
	}

	// Size is an exact discriminator: it can reject every candidate without
	// reading a single byte of content.
	if (link.size !== undefined) {
		const sizeFiltered = await filesOfSize(candidates, link.size);
		if (sizeFiltered.length === 0) {
			return undefined;
		}
		return matchingHash(sizeFiltered, link.hash);
	}

	return matchingHash(candidates, link.hash);
}

/**
 * Relocalizes dead links against the files found under `searchFolder`.
 * Resolves each link with the cheapest tier that can answer it, then runs one
 * full scan-and-hash pass only for the links the cheap tiers could not settle
 * (moved-and-renamed files, or ambiguous filename+size collisions).
 *
 * @param options - Relocalization options including dead links and search folder
 * @returns Promise with matches map and list of not-found paths
 */
export async function relocalizeFiles(options: RelocalizeOptions): Promise<RelocalizeResult> {
	const { deadLinks, searchFolder, onProgress, isCancelled } = options;
	const matches = new Map<string, string>();
	const notFound: string[] = [];
	const needsFallback: DeadLinkInfo[] = [];

	// Pause between progress updates so Obsidian's UI can repaint during this
	// long, I/O-bound job. Without this the modal freezes mid-scan.
	const yieldToUI = () => new Promise<void>(resolve => window.setTimeout(resolve, 0));
	const report = (phase: string, current: number, total: number, detail?: string) => {
		onProgress?.({ phase, current, total, detail });
		return yieldToUI();
	};

	await report("Scanning folder for video files...", 0, 100);
	if (isCancelled?.()) {
		return { matches, notFound };
	}

	const videoFiles = await scanFolderForVideos(searchFolder);
	const filesByName = groupByFilename(videoFiles);
	await report("Scanning folder for video files...", 100, 100, `Found ${videoFiles.length} video files`);
	if (isCancelled?.()) {
		return { matches, notFound };
	}

	for (let i = 0; i < deadLinks.length; i++) {
		if (isCancelled?.()) {
			return { matches, notFound };
		}
		const link = deadLinks[i];
		if (!link) continue;

		await report("Matching files...", i + 1, deadLinks.length, `Checking: ${path.basename(link.originalPath).toLowerCase()}`);

		const match = await matchLink(link, filesByName);
		if (match) {
			matches.set(link.originalPath, match);
		} else {
			needsFallback.push(link);
		}
	}

	if (needsFallback.length === 0) {
		return { matches, notFound };
	}

	await report(
		"Building hash map for remaining files...",
		0,
		videoFiles.length,
		`${needsFallback.length} links need full hash search`
	);
	if (isCancelled?.()) {
		return { matches, notFound };
	}

	// Expensive pass: hash every video once, then resolve the deferred links.
	const hashMap = new Map<string, string>();
	for (let i = 0; i < videoFiles.length; i++) {
		if (isCancelled?.()) {
			return { matches, notFound };
		}
		const filePath = videoFiles[i];
		if (!filePath) continue;

		await report("Computing hashes...", i + 1, videoFiles.length, path.basename(filePath));
		try {
			hashMap.set(await calculatePartialMD5(filePath), filePath);
		} catch {
			// Skip unreadable files; they can never serve as a match.
		}
	}

	for (const link of needsFallback) {
		const newPath = hashMap.get(link.hash);
		if (newPath) {
			matches.set(link.originalPath, newPath);
		} else {
			notFound.push(link.originalPath);
		}
	}

	return { matches, notFound };
}
