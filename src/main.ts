import {
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	App,
	Setting,
} from "obsidian";
import "@total-typescript/ts-reset";
import "@total-typescript/ts-reset/dom";
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

import { MessageModal } from "./modals/MessageModal";
import { PathSelectModal } from "./modals/PathSelectModal";
import { ProgressModal } from "./modals/ProgressModal";
import { calculatePartialMD5, relocalizeFiles, DeadLinkInfo } from "./hash";
import { getLuaScriptPath, log, resolveToAbsolutePath, toVaultRelativePath, getVaultBasePath } from "./utils";
import { MpvLinksSettings, DEFAULT_SETTINGS, VideoLinkDetails } from "./types";
import { buildMpvArgs } from "./mpv-command";
import { MPV_CODE_BLOCK_START, DEFAULT_TIMESTAMP, BUTTON_LINK_ATTR } from "./constants";
import {
	VIDEO_LINK_REGEX,
	extractDetails,
	isLinkFixed,
	extractTimestampInfo,
	timestampToSeconds,
	secondsToTimestamp,
	getStartTimestampFromText,
	replaceTimestampInLink,
	replaceAllLinkOccurrences,
	sortMpvLinkBlocksByFileName,
} from "./link-parser";

// Re-export for backwards compatibility
export { VIDEO_LINK_REGEX, extractDetails, isLinkFixed, extractTimestampInfo, timestampToSeconds, secondsToTimestamp };
export type { TimestampInfo } from "./link-parser";


/**
 * Extracts the timestamp from a video button's text
 * @param button - The HTML button element containing video link information
 * @returns The timestamp in format HH:MM:SS with any # characters removed
 */
export function getStartTimestamp(button: HTMLButtonElement): string {
	log({ input: button.innerText });
	return getStartTimestampFromText(button.innerText);
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
 * Formats a file path into a properly formatted video link markdown code block
 * @param filePath - The path to the video file
 * @param vaultBasePath - The base path of the Obsidian vault for relative path conversion
 * @param includeHash - Whether to include MD5 hash and filesize for relocalization
 * @returns Formatted markdown code block with video link
 */
export async function formatFilepathToVideoLink(filePath: string, vaultBasePath: string, includeHash = false): Promise<string> {
	const uniqueId = Date.now().toString();
	const relativePath = toVaultRelativePath(filePath, vaultBasePath);

	let metadataSuffix = "";
	if (includeHash) {
		try {
			const hash = await calculatePartialMD5(filePath);
			const stats = await fs.promises.stat(filePath);
			metadataSuffix = `#hash:${hash}#size:${stats.size}`;
		} catch (error) {
			console.warn(`Could not calculate hash/size for: ${filePath}`, error);
		}
	}

	return `\n\`\`\` ${MPV_CODE_BLOCK_START} \n[[${uniqueId}#video:${relativePath}#${DEFAULT_TIMESTAMP}${metadataSuffix}]]\n\`\`\``;
}

// ============================================================================
// Helper Functions
// ============================================================================

function executeFile(binary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(binary, args, (error, stdout, stderr) => {
			if (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

function createVideoButton(details: VideoLinkDetails, videoLink: string, onClick: () => void): HTMLButtonElement {
	const button = createEl("button");
	const fileName = path.basename(details.filepath);

	button.setAttribute(BUTTON_LINK_ATTR, videoLink);
	const displayTimestamp = details.isFixed ? `#${details.timestamp}#` : details.timestamp;
	button.textContent = `${fileName}/${displayTimestamp}`;
	button.onclick = onClick;

	return button;
}

// ============================================================================
// Plugin Class
// ============================================================================

interface DeadLinkWithHash {
	link: string;
	deadLinkInfo: DeadLinkInfo;
}

/**
 * The links whose video file is missing on disk and that still carry a stored
 * hash — exactly the ones relocalization can still recover by content.
 */
function findDeadLinksWithHash(content: string, vaultBasePath: string): DeadLinkWithHash[] {
	const deadLinks: DeadLinkWithHash[] = [];
	for (const link of content.match(VIDEO_LINK_REGEX) ?? []) {
		const details = extractDetails(link);
		if (!details.hash) continue;
		if (fs.existsSync(resolveToAbsolutePath(details.filepath, vaultBasePath))) continue;

		deadLinks.push({
			link,
			deadLinkInfo: {
				originalPath: details.filepath,
				filename: path.basename(details.filepath),
				hash: details.hash,
				size: details.size,
			},
		});
	}
	return deadLinks;
}

export default class MpvLinksPlugin extends Plugin {
	settings: MpvLinksSettings = DEFAULT_SETTINGS;
	private startDir = "";
	private selectedLinkIndex = -1;
	private mpvButtons: HTMLButtonElement[] = [];
	private containers: HTMLElement[] = [];

	onload(): void {
		void this.initialize();
	}

	private async initialize(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MpvLinksSettingTab(this.app, this));

		this.startDir = getVaultBasePath(this.app);
		if (this.settings.rememberLastFolder && this.settings.lastFolderPath) {
			this.startDir = this.settings.lastFolderPath;
		}

		this.registerMarkdownCodeBlockProcessor(MPV_CODE_BLOCK_START, (source, el) => {
			this.createButtonsFromMarkdown(source, el);
			this.containers.push(el);
			el.setAttribute("tabindex", "0");

			el.addEventListener("keydown", (evt: KeyboardEvent) => {
				if (evt.key === "Enter") {
					const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button"));
					const activeButton = buttons.find(btn => btn.classList.contains("mpv-selected-link"));
					if (activeButton) {
						activeButton.click();
						evt.preventDefault();
					}
				}
			});
		});

		this.registerCommands();
	}

	private registerCommands(): void {
		this.addCommand({
			id: "add-mpv-link",
			name: "Add mpv link",
			editorCallback: (editor: Editor) => {
				new PathSelectModal(
					this.app,
					this.startDir,
					"file",
					(filePaths: string[]) => this.addSelectedLinks(editor, filePaths),
					true // multiSelect
				).open();
			}
		});

		this.addCommand({
			id: "next-mpv-link",
			name: "Go to next MPV link",
			callback: () => this.navigateLinks(1)
		});

		this.addCommand({
			id: "previous-mpv-link",
			name: "Go to previous MPV link",
			callback: () => this.navigateLinks(-1)
		});

		this.addCommand({
			id: "open-selected-mpv-link",
			name: "Open selected MPV link",
			callback: () => this.openSelectedLink()
		});

		this.addCommand({
			id: "clean-dead-links",
			name: "Clean dead links",
			callback: () => this.cleanDeadLinks()
		});

		this.addCommand({
			id: "relocalize-links",
			name: "Update/relocalize links",
			callback: () => this.relocalizeLinks()
		});

		this.addCommand({
			id: "sort-links-by-name",
			name: "Sort links by name",
			callback: () => this.sortLinksByName()
		});
	}

	// ========================================================================
	// Link Creation
	// ========================================================================

	/**
	 * Turns the user's chosen files into mpv_link blocks at the cursor, then
	 * remembers the chosen folder when the setting asks for it.
	 */
	private async addSelectedLinks(editor: Editor, filePaths: string[]): Promise<void> {
		const vaultBasePath = getVaultBasePath(this.app);
		const includeHash = this.settings.enableHashRelocalization;

		for (const filePath of filePaths) {
			const linkBlock = await formatFilepathToVideoLink(filePath, vaultBasePath, includeHash);
			editor.replaceRange(linkBlock, editor.getCursor("from"));
		}

		const firstFile = filePaths[0];
		if (!firstFile) {
			return;
		}
		this.startDir = path.dirname(firstFile);
		if (!this.settings.rememberLastFolder) {
			return;
		}
		this.settings.lastFolderPath = this.startDir;
		await this.saveSettings();
	}

	// ========================================================================
	// Video Playback
	// ========================================================================

	private createButtonsFromMarkdown(markdown: string, container: HTMLElement): void {
		const videoLinks = markdown.match(VIDEO_LINK_REGEX) || [];

		videoLinks.forEach((videoLink) => {
			const details = extractDetails(videoLink);
			const button = createVideoButton(details, videoLink, () => {
				void this.openVideoAtTime(details.filepath, button);
			});
			container.appendChild(button);
		});
	}

	private async openVideoAtTime(filePath: string, button: HTMLButtonElement): Promise<void> {
		const startTimestamp = getStartTimestamp(button);
		const vaultBasePath = getVaultBasePath(this.app);
		const absolutePath = resolveToAbsolutePath(filePath, vaultBasePath);

		try {
			const luaScriptPath = getLuaScriptPath();
			const args = buildMpvArgs(startTimestamp, luaScriptPath, absolutePath);
			const { stdout } = await executeFile('mpv', args);
			await this.updateTimestampInMarkdown(button, stdout);
		} catch (error) {
			console.error('Error executing MPV command:', error);
			const msg = error instanceof Error ? error.message : String(error);
			new MessageModal(this.app, msg, "error").open();
		}
	}

	/**
	 * Caps a recorded playback position to the configured number of seconds
	 * before the video ends. Without this, a link saved right when the video
	 * finished would seek to the last frame and close immediately on reopen.
	 */
	private applyEndBuffer(timestamp: string, duration: string | undefined): string {
		if (!duration) {
			return timestamp;
		}

		const bufferSeconds = this.settings.endBufferSeconds;
		if (bufferSeconds <= 0) {
			return timestamp;
		}

		const latestPlayable = timestampToSeconds(duration) - bufferSeconds;
		const recorded = timestampToSeconds(timestamp);
		if (latestPlayable <= 0 || recorded <= latestPlayable) {
			return timestamp;
		}

		const capped = secondsToTimestamp(latestPlayable);
		log(`Capping timestamp from ${timestamp} to ${capped} (buffer: ${bufferSeconds}s)`);
		return capped;
	}

	private async updateTimestampInMarkdown(button: HTMLButtonElement, mpvStdout: string): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const timestampInfo = extractTimestampInfo(mpvStdout);
		if (!timestampInfo.timestamp) return;

		const finalTimestamp = this.applyEndBuffer(timestampInfo.timestamp, timestampInfo.duration);

		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const activeFileContent = await this.app.vault.read(file);
		const originalLink = button.getAttribute(BUTTON_LINK_ATTR);

		if (!originalLink || isLinkFixed(originalLink)) {
			log("Timestamp is fixed, not updating");
			return;
		}

		const newLink = replaceTimestampInLink(originalLink, finalTimestamp);
		const newMarkdown = replaceAllLinkOccurrences(activeFileContent, originalLink, newLink);

		await this.app.vault.modify(file, newMarkdown);
		log(mpvStdout);
	}

	// ========================================================================
	// Link Navigation
	// ========================================================================

	private navigateLinks(direction: number): void {
		this.updateButtonsList();

		if (this.mpvButtons.length === 0) return;

		this.clearSelection();

		if (this.selectedLinkIndex === -1) {
			this.selectedLinkIndex = direction > 0 ? 0 : this.mpvButtons.length - 1;
		} else {
			this.selectedLinkIndex = (this.selectedLinkIndex + direction + this.mpvButtons.length) % this.mpvButtons.length;
		}

		const selectedButton = this.mpvButtons[this.selectedLinkIndex];
		if (selectedButton) {
			selectedButton.classList.add("mpv-selected-link");
			selectedButton.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}

	private updateButtonsList(): void {
		this.mpvButtons = [];
		this.containers.forEach(container => {
			const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
			this.mpvButtons.push(...buttons);
		});
	}

	private clearSelection(): void {
		this.mpvButtons.forEach(button => {
			button.classList.remove("mpv-selected-link");
		});
	}

	private openSelectedLink(): void {
		if (this.selectedLinkIndex >= 0 && this.selectedLinkIndex < this.mpvButtons.length) {
			const selectedButton = this.mpvButtons[this.selectedLinkIndex];
			if (selectedButton) {
				selectedButton.click();
			}
		}
	}

	// ========================================================================
	// Link Maintenance
	// ========================================================================

	/**
	 * Rewrites the active note so its mpv_link code blocks are ordered by the
	 * filename of the referenced video (case-insensitive), and the links inside
	 * each block are sorted too. Non-mpv_link content is left untouched.
	 */
	private async sortLinksByName(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;

		const content = await this.app.vault.read(file);
		const sortedContent = sortMpvLinkBlocksByFileName(content);

		// Skip identical writes: an unchanged modify() still fires Obsidian's
		// file-change hooks and clobbers the undo history for no reason.
		if (sortedContent !== content) {
			await this.app.vault.modify(file, sortedContent);
		}

		this.clearSelection();
		this.selectedLinkIndex = -1;
	}

	private async cleanDeadLinks(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new MessageModal(this.app, "No active file", "error").open();
			return;
		}

		const content = await this.app.vault.read(file);
		const vaultBasePath = getVaultBasePath(this.app);
		const codeBlockRegex = /\n?```\s*mpv_link\s*\n([\s\S]*?)```/g;

		let removedCount = 0;
		const newContent = content.replace(codeBlockRegex, (match, blockContent: string) => {
			const videoLinks = blockContent.match(VIDEO_LINK_REGEX) || [];

			const hasDeadLink = videoLinks.some((link: string) => {
				const details = extractDetails(link);
				const absolutePath = resolveToAbsolutePath(details.filepath, vaultBasePath);
				return !fs.existsSync(absolutePath);
			});

			if (hasDeadLink) {
				removedCount++;
				return "";
			}
			return match;
		});

		if (removedCount > 0) {
			await this.app.vault.modify(file, newContent);
			log(`Removed ${removedCount} dead mpv link(s)`);
		}
	}

	private async relocalizeLinks(): Promise<void> {
		if (!this.settings.enableHashRelocalization) {
			new MessageModal(this.app, "Hash relocalization is disabled. Enable it in settings first.", "error").open();
			return;
		}

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new MessageModal(this.app, "No active file", "error").open();
			return;
		}

		const content = await this.app.vault.read(file);
		const vaultBasePath = getVaultBasePath(this.app);

		const deadLinksWithHash = findDeadLinksWithHash(content, vaultBasePath);

		if (deadLinksWithHash.length === 0) {
			new MessageModal(this.app, "No dead links with hashes found to relocalize.", "info").open();
			return;
		}

		new PathSelectModal(this.app, this.startDir, "folder", async (paths: string[]) => {
			const folderPath = paths[0];
			if (!folderPath) return;

			log(`Scanning folder: ${folderPath}`);

			// Show progress modal
			let cancelled = false;
			const progressModal = new ProgressModal(
				this.app,
				"Relocalizing files...",
				() => { cancelled = true; }
			);
			progressModal.open();

			try {
				// Run tiered relocalization with progress updates
				const result = await relocalizeFiles({
					deadLinks: deadLinksWithHash.map(d => d.deadLinkInfo),
					searchFolder: folderPath,
					onProgress: (progress) => {
						progressModal.updateProgress(progress);
					},
					isCancelled: () => cancelled
				});

				progressModal.close();

				if (cancelled) {
					new MessageModal(this.app, "Relocalization cancelled.", "info").open();
					return;
				}

				// Apply matches to content
				let updatedCount = 0;
				let newContent = content;

				for (const { link, deadLinkInfo } of deadLinksWithHash) {
					const newFilePath = result.matches.get(deadLinkInfo.originalPath);
					if (newFilePath) {
						const newRelativePath = toVaultRelativePath(newFilePath, vaultBasePath);
						const newLink = link.replace(deadLinkInfo.originalPath, newRelativePath);
						newContent = newContent.replace(link, newLink);
						updatedCount++;
						log(`Updated: ${deadLinkInfo.originalPath} -> ${newRelativePath}`);
					} else {
						log(`Not found: ${deadLinkInfo.originalPath} (hash: ${deadLinkInfo.hash})`);
					}
				}

				if (updatedCount > 0) {
					await this.app.vault.modify(file, newContent);
				}

				const message = `Relocalized ${updatedCount} link(s). ${result.notFound.length} not found.`;
				log(message);
				new MessageModal(this.app, message, updatedCount > 0 ? "success" : "info").open();
			} catch (error) {
				progressModal.close();
				console.error('Error during relocalization:', error);
				new MessageModal(this.app, `Error: ${(error as Error).message}`, "error").open();
			}
		}).open();
	}

	// ========================================================================
	// Settings
	// ========================================================================

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

// ============================================================================
// Settings Tab
// ============================================================================

class MpvLinksSettingTab extends PluginSettingTab {
	plugin: MpvLinksPlugin;

	constructor(app: App, plugin: MpvLinksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Remember last folder")
			.setDesc("When adding a new mpv link, start from the last folder you selected instead of the vault folder.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.rememberLastFolder)
					.onChange(async (value) => {
						this.plugin.settings.rememberLastFolder = value;
						if (!value) {
							this.plugin.settings.lastFolderPath = "";
						}
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Relocalize files based on their hash (Experimental!!!)")
			.setDesc("Store MD5 hash when creating links. Allows finding moved files by content using the 'Update/relocalize links' command.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableHashRelocalization)
					.onChange(async (value) => {
						this.plugin.settings.enableHashRelocalization = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("End-of-video buffer (seconds)")
			.setDesc("When saving timestamp, cap it to this many seconds before the end. Prevents links that open and close instantly when video ends.")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(this.plugin.settings.endBufferSeconds.toString())
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed >= 0) {
							this.plugin.settings.endBufferSeconds = parsed;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
