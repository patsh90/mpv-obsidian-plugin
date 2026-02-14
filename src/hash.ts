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

	// bun-types incorrectly types fs.promises.open as Promise<number>; at runtime it returns a FileHandle
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const fh: any = await fs.promises.open(filePath, 'r');
	const buffer = Buffer.alloc(readSize);
	try {
		await fh.read(buffer, 0, readSize, 0);
	} finally {
		await fh.close();
	}

	return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Recursively scans a folder for video files
 * @param folderPath - The folder to scan
 * @returns Array of absolute paths to video files
 */
export async function scanFolderForVideos(folderPath: string): Promise<string[]> {
	const videoFiles: string[] = [];

	async function scanRecursive(dir: string): Promise<void> {
		try {
			const entries = await fs.promises.readdir(dir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
						await scanRecursive(fullPath);
					}
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name).toLowerCase();
					if (VIDEO_EXTENSIONS.includes(ext)) {
						videoFiles.push(fullPath);
					}
				}
			}
		} catch (error) {
			console.warn(`Could not read directory: ${dir}`);
		}
	}

	await scanRecursive(folderPath);
	return videoFiles;
}

/**
 * Builds a map of hash -> filepath for a list of video files
 * @param filePaths - Array of absolute file paths
 * @returns Map where key is the partial MD5 hash and value is the file path
 */
export async function buildHashMap(filePaths: string[]): Promise<Map<string, string>> {
	const hashMap = new Map<string, string>();

	for (const filePath of filePaths) {
		try {
			const hash = await calculatePartialMD5(filePath);
			hashMap.set(hash, filePath);
		} catch (error) {
			console.warn(`Could not hash file: ${filePath}`);
		}
	}

	return hashMap;
}

// ============================================================================
// Tiered Relocalization
// ============================================================================

/**
 * Gets the file size for a given path
 * @param filePath - Absolute path to the file
 * @returns File size in bytes, or undefined if file doesn't exist/can't be read
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
 * Relocalize files using tiered matching strategy (cheapest to most expensive)
 *
 * Tier 1: Filename match (instant - string comparison)
 * Tier 2: Filesize match (fast - single stat call per candidate)
 * Tier 3: Hash match (slow - only when needed)
 *
 * @param options - Relocalization options including dead links and search folder
 * @returns Promise with matches map and list of not-found paths
 */
export async function relocalizeFiles(options: RelocalizeOptions): Promise<RelocalizeResult> {
	const { deadLinks, searchFolder, onProgress, isCancelled } = options;
	const matches = new Map<string, string>();
	const notFound: string[] = [];
	const needsHashFallback: DeadLinkInfo[] = [];

	const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

	onProgress?.({ phase: "Scanning folder for video files...", current: 0, total: 100 });
	await yieldToUI();

	if (isCancelled?.()) {
		return { matches, notFound };
	}

	const videoFiles = await scanFolderForVideos(searchFolder);
	const totalFiles = videoFiles.length;

	onProgress?.({
		phase: "Scanning folder for video files...",
		current: 100,
		total: 100,
		detail: `Found ${totalFiles} video files`
	});
	await yieldToUI();

	if (isCancelled?.()) {
		return { matches, notFound };
	}

	const filesByName = groupByFilename(videoFiles);
	const totalLinks = deadLinks.length;

	for (let i = 0; i < deadLinks.length; i++) {
		if (isCancelled?.()) {
			return { matches, notFound };
		}

		const link = deadLinks[i];
		if (!link) continue;

		const linkFilename = path.basename(link.originalPath).toLowerCase();

		onProgress?.({
			phase: "Matching files...",
			current: i + 1,
			total: totalLinks,
			detail: `Checking: ${linkFilename}`
		});
		await yieldToUI();

		// Tier 1: Filename match
		const candidates = filesByName.get(linkFilename) || [];

		if (candidates.length === 0) {
			needsHashFallback.push(link);
			continue;
		}

		// Tier 2: Filter by filesize (if we have size info)
		let sizeFilteredCandidates = candidates;
		if (link.size !== undefined) {
			sizeFilteredCandidates = [];
			for (const filePath of candidates) {
				const fileSize = await getFileSize(filePath);
				if (fileSize === link.size) {
					sizeFilteredCandidates.push(filePath);
				}
			}

			if (sizeFilteredCandidates.length === 0) {
				needsHashFallback.push(link);
				continue;
			}
		}

		// Tier 3: Hash verification for remaining candidates
		let matched = false;
		for (const candidate of sizeFilteredCandidates) {
			try {
				const candidateHash = await calculatePartialMD5(candidate);
				if (candidateHash === link.hash) {
					matches.set(link.originalPath, candidate);
					matched = true;
					break;
				}
			} catch {
				// Skip files we can't hash
			}
		}

		if (!matched) {
			needsHashFallback.push(link);
		}
	}

	if (needsHashFallback.length > 0) {
		onProgress?.({
			phase: "Building hash map for remaining files...",
			current: 0,
			total: totalFiles,
			detail: `${needsHashFallback.length} links need full hash search`
		});
		await yieldToUI();

		// Build hash map for ALL video files (expensive but only done if needed)
		const hashMap = new Map<string, string>();

		for (let i = 0; i < videoFiles.length; i++) {
			if (isCancelled?.()) {
				return { matches, notFound };
			}

			const filePath = videoFiles[i];
			if (!filePath) continue;

			onProgress?.({
				phase: "Computing hashes...",
				current: i + 1,
				total: totalFiles,
				detail: path.basename(filePath)
			});
			await yieldToUI();

			try {
				const hash = await calculatePartialMD5(filePath);
				hashMap.set(hash, filePath);
			} catch {
				// Skip files we can't hash
			}
		}

		for (const link of needsHashFallback) {
			const newPath = hashMap.get(link.hash);
			if (newPath) {
				matches.set(link.originalPath, newPath);
			} else {
				notFound.push(link.originalPath);
			}
		}
	}

	return { matches, notFound };
}
