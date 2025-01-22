import {
	Editor,
	MarkdownView,
	Plugin,
} from "obsidian";
import "@total-typescript/ts-reset";
import "@total-typescript/ts-reset/dom";
import { ErrorModal } from "./modals/ErrorModal";
import { FileSelectModal } from "./modals/FileSelectModal";

const MPV_CODE_BLOCK_START: string = "mpv_link";
const DEFAULT_TIMESTAMP = "00:00:00";
const BUTTON_LINK_ATTR = "link";
export const LOGINFO: boolean = true;
// Fix: Updated regex to properly match both formats of timestamps
// Format can be either [[id#video:path#timestamp]] or [[id#video:path#timestamp#]] for fixed
const VIDEO_LINK_REGEX = /\[\[\d*#video:.*?#\d\d:\d\d:\d\d(?:#)?]]/g;


import { exec } from 'child_process';



/**
 * Extracts the last timestamp from MPV player's stdout output
 * @param stdout - The standard output from the MPV process
 * @returns The extracted timestamp in format HH:MM:SS or default timestamp if not found
 */
export function extractLastTimestamp(stdout: string): string {
	const timeRegex = /\[ (\d{2}:\d{2}:\d{2}) ]/;
	const match = stdout.match(timeRegex);
	return match?.[1] ?? DEFAULT_TIMESTAMP;
}

/**
 * Extracts the timestamp from a video button's text
 * @param button - The HTML button element containing video link information
 * @returns The timestamp in format HH:MM:SS with any # characters removed
 */
export function getStartTimestamp(button: HTMLButtonElement): string {
	log({ input: button.innerText });
	// The button text timestamp may have multiple # characters
	// We need to remove all # characters to get the actual timestamp
	return button.innerText.split("/")[1]?.replace(/#/g, "") ?? DEFAULT_TIMESTAMP;
}

import { getLuaScriptPath, log } from "./utils";
async function openVideoAtTime(filePath: string, button: HTMLButtonElement): Promise<void> {
	const startTimestamp = getStartTimestamp(button);
	const luaScriptPath = getLuaScriptPath();
	const command = `mpv --start=${startTimestamp} --script=${luaScriptPath} "${filePath}"`;

	try {
		const { stdout, stderr } = await executeCommand(command);
		await updateTimestampInMarkdown(button, stdout);
	} catch (error) {
		console.error('Error executing MPV command:', error);
		new ErrorModal(this.app, error.message).open();
	}
}

function executeCommand(command: string): Promise<{ stdout: string, stderr: string }> {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

async function updateTimestampInMarkdown(button: HTMLButtonElement, mpvStdout: string): Promise<void> {
	const view = this.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return;
	const newTimestamp = extractLastTimestamp(mpvStdout);
	if (!newTimestamp) return;
	const file = this.app.workspace.getActiveFile();
	if (!file) return;

	const activeFileContent = await this.app.vault.read(file);
	const originalLink = button.getAttribute(BUTTON_LINK_ATTR);

	if (!originalLink || isLinkFixed(originalLink)) {
		// Don't update fixed timestamps
		log("Timestamp is fixed, not updating");
		return;
	}

	const startTimestamp = getStartTimestamp(button);
	// Fix: The replace should account for potential # marks in button text
	const cleanStartTimestamp = startTimestamp.replace(/#/g, "");
	const newLink = originalLink.replace(cleanStartTimestamp, newTimestamp);
	const newMarkdown = activeFileContent.replace(originalLink, newLink);

	await this.app.vault.modify(file, newMarkdown);
	log(mpvStdout);
}

/**
 * Extracts video details from a formatted video link string
 * @param input - The video link string in format [[id#video:path#timestamp(#)]]
 * @returns Object containing filepath, timestamp, and isFixed flag
 */
export function extractDetails(input: string): { filepath: string; timestamp: string; isFixed: boolean } {
	// Updated regex to properly capture filepath and timestamp, including fixed timestamps
	// Format can be either [[id#video:path#timestamp]] or [[id#video:path#timestamp#]] for fixed
	const videoLinkRegex = /\[\[\d+#video:(.+?)#(.+?)(#)?]]/;
	const match = input.match(videoLinkRegex);

	return match && match[1] && match[2]
		? { 
			filepath: match[1], 
			timestamp: match[2],
			// If match[3] exists, it means there was an extra # marking a fixed timestamp
			isFixed: !!match[3]  
		}
		: { filepath: "/", timestamp: DEFAULT_TIMESTAMP, isFixed: false };
}


function createButtonsFromMarkdown(markdown: string, container: HTMLElement): void {
	const videoLinks = markdown.match(VIDEO_LINK_REGEX) || [];
	videoLinks.forEach((videoLink) => {
		const details = extractDetails(videoLink);
		const button = createVideoButton(details, videoLink);
		container.appendChild(button);
	});
}

interface VideoLinkDetails {
	filepath: string;
	timestamp: string;
	isFixed: boolean; // Added to track if this is a fixed timestamp
}

import * as path from 'path';

function createVideoButton(details: VideoLinkDetails, videoLink: string): HTMLButtonElement {
	const button = document.createElement("button");
	const fileName = path.basename(details.filepath);

	button.setAttribute(BUTTON_LINK_ATTR, videoLink);
	// Fix: Modify button text to show # around timestamp if it's fixed
	const displayTimestamp = details.isFixed ? `#${details.timestamp}#` : details.timestamp;
	button.textContent = `${fileName}/${displayTimestamp}`;
	button.onclick = () => openVideoAtTime(details.filepath, button);

	return button;
}

/**
 * Formats a file path into a properly formatted video link markdown code block
 * @param filePath - The path to the video file
 * @returns Formatted markdown code block with video link
 */
export function formatFilepathToVideoLink(filePath: string): string {
	const uniqueId = Date.now().toString();
	return `\n\`\`\` ${MPV_CODE_BLOCK_START} \n[[${uniqueId}#video:${filePath}#${DEFAULT_TIMESTAMP}]]\n\`\`\``;
}



// Plugin definition
export default class MpvLinksPlugin extends Plugin {
	startDir = (this.app.vault.adapter as any).basePath;

	async onload() {

		this.registerMarkdownCodeBlockProcessor(MPV_CODE_BLOCK_START, (source, el) => {
			const body = el.createEl("body");
			createButtonsFromMarkdown(source, body);
		});

		this.addCommand({
			id: "add-mpv-link",
			name: "Add mpv link",
			editorCallback: (editor: Editor) => {
				new FileSelectModal(this.app, this.startDir, (filePaths: string[]) => {
					filePaths.forEach(filePath => editor.replaceRange(formatFilepathToVideoLink(filePath), editor.getCursor("from")));

					if (filePaths.length > 0 && filePaths[0]) {
						this.startDir = path.dirname(filePaths[0]);
					}
				}
				).open();

			}
		});
	}
}
/**
 * Determines if a video link has a fixed timestamp
 * Fixed timestamps are marked with an extra # at the end and won't be updated
 * @param originalLink - The video link string to check
 * @returns Boolean indicating if the timestamp is fixed
 */
export function isLinkFixed(originalLink: string): boolean {
	// Check if the timestamp format has # at the end (fixed timestamp)
	// Format is like [[id#video:path#timestamp#]] where the last # makes it fixed
	const timestampEndRegex = /#\d\d:\d\d:\d\d#/;
	return timestampEndRegex.test(originalLink);
}