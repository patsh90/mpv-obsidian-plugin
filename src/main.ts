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
const VIDEO_LINK_REGEX = /\[\[\d*#video:.*?#\d\d:\d\d:\d\d#?]]/g;


import { exec } from 'child_process';



// Function to extract the last timestamp from MPV output
function extractLastTimestamp(stdout: string): string {
	const timeRegex = /\[ (\d{2}:\d{2}:\d{2}) ]/;
	const match = stdout.match(timeRegex);
	return match?.[1] ?? DEFAULT_TIMESTAMP;
}

function getStartTimestamp(button: HTMLButtonElement): string {
	log({ input: button.innerText });
	return button.innerText.split("/")[1]?.replace("#", "") ?? DEFAULT_TIMESTAMP;
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
	if (!originalLink || isLinkFixed(originalLink)) return;

	const startTimestamp = getStartTimestamp(button);
	const newLink = originalLink.replace(startTimestamp, newTimestamp);
	const newMarkdown = activeFileContent.replace(originalLink, newLink);

	await this.app.vault.modify(file, newMarkdown);
	log(mpvStdout);
}

function extractDetails(input: string): { filepath: string; timestamp: string } {
	const videoLinkRegex = /\[\[\d+#video:(.+?)#(.+?)]]/;
	const match = input.match(videoLinkRegex);

	return match && match[1] && match[2]
		? { filepath: match[1], timestamp: match[2] }
		: { filepath: "/", timestamp: DEFAULT_TIMESTAMP };
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
}

import * as path from 'path';

function createVideoButton(details: VideoLinkDetails, videoLink: string): HTMLButtonElement {
	const button = document.createElement("button");
	const fileName = path.basename(details.filepath);

	button.setAttribute(BUTTON_LINK_ATTR, videoLink);
	button.textContent = `${fileName}/${details.timestamp}`;
	button.onclick = () => openVideoAtTime(details.filepath, button);

	return button;
}

function formatFilepathToVideoLink(filePath: string): string {
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
function isLinkFixed(originalLink: string): boolean {
	const lastCharacter = originalLink.charAt(originalLink.length - 2);
	return lastCharacter === '#';
}