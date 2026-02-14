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
export async function formatFilepathToVideoLink(filePath: string, vaultBasePath: string, includeHash: boolean = false): Promise<string> {
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
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

function createVideoButton(details: VideoLinkDetails, videoLink: string, onClick: () => void): HTMLButtonElement {
	const button = document.createElement("button");
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

export default class MpvLinksPlugin extends Plugin {
	settings: MpvLinksSettings = DEFAULT_SETTINGS;
	private startDir: string = "";
	private selectedLinkIndex: number = -1;
	private mpvButtons: HTMLButtonElement[] = [];
	private containers: HTMLElement[] = [];

	async onload(): Promise<void> {
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
					const buttons = Array.from(el.querySelectorAll("button")) as HTMLButtonElement[];
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
					async (filePaths: string[]) => {
						const vaultBasePath = getVaultBasePath(this.app);
						const includeHash = this.settings.enableHashRelocalization;
						for (const filePath of filePaths) {
							const text = await formatFilepathToVideoLink(filePath, vaultBasePath, includeHash);
							editor.replaceRange(text, editor.getCursor("from"));
						}

						if (filePaths.length > 0 && filePaths[0]) {
							this.startDir = path.dirname(filePaths[0]);
							if (this.settings.rememberLastFolder) {
								this.settings.lastFolderPath = this.startDir;
								await this.saveSettings();
							}
						}
					},
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
			name: "Clean dead mpv links",
			callback: () => this.cleanDeadLinks()
		});

		this.addCommand({
			id: "relocalize-links",
			name: "Update/relocalize links",
			callback: () => this.relocalizeLinks()
		});
	}

	// ========================================================================
	// Video Playback
	// ========================================================================

	private createButtonsFromMarkdown(markdown: string, container: HTMLElement): void {
		const vaultBasePath = getVaultBasePath(this.app);
		const videoLinks = markdown.match(VIDEO_LINK_REGEX) || [];

		videoLinks.forEach((videoLink) => {
			const details = extractDetails(videoLink);
			const button = createVideoButton(details, videoLink, () => {
				this.openVideoAtTime(details.filepath, button);
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

	private async updateTimestampInMarkdown(button: HTMLButtonElement, mpvStdout: string): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		const timestampInfo = extractTimestampInfo(mpvStdout);
		if (!timestampInfo.timestamp) return;

		// Apply end-of-video buffer
		let finalTimestamp = timestampInfo.timestamp;
		if (timestampInfo.duration && this.settings.endBufferSeconds > 0) {
			const timestampSeconds = timestampToSeconds(timestampInfo.timestamp);
			const durationSeconds = timestampToSeconds(timestampInfo.duration);
			const maxTimestamp = durationSeconds - this.settings.endBufferSeconds;

			if (timestampSeconds > maxTimestamp && maxTimestamp > 0) {
				finalTimestamp = secondsToTimestamp(maxTimestamp);
				log(`Capping timestamp from ${timestampInfo.timestamp} to ${finalTimestamp} (buffer: ${this.settings.endBufferSeconds}s)`);
			}
		}

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
			const buttons = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
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

		const videoLinks = content.match(VIDEO_LINK_REGEX) || [];
		const deadLinksWithHash: { link: string; deadLinkInfo: DeadLinkInfo; details: VideoLinkDetails }[] = [];

		for (const link of videoLinks) {
			const details = extractDetails(link);
			if (details.hash) {
				const absolutePath = resolveToAbsolutePath(details.filepath, vaultBasePath);
				if (!fs.existsSync(absolutePath)) {
					deadLinksWithHash.push({
						link,
						deadLinkInfo: {
							originalPath: details.filepath,
							filename: path.basename(details.filepath),
							hash: details.hash,
							size: details.size
						},
						details
					});
				}
			}
		}

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

				for (const { link, deadLinkInfo, details } of deadLinksWithHash) {
					const newFilePath = result.matches.get(deadLinkInfo.originalPath);
					if (newFilePath) {
						const newRelativePath = toVaultRelativePath(newFilePath, vaultBasePath);
						const newLink = link.replace(details.filepath, newRelativePath);
						newContent = newContent.replace(link, newLink);
						updatedCount++;
						log(`Updated: ${details.filepath} -> ${newRelativePath}`);
					} else {
						log(`Not found: ${details.filepath} (hash: ${deadLinkInfo.hash})`);
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
