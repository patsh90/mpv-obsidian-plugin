import {
	Editor,
	MarkdownView,
	Plugin,
} from "obsidian";
import "@total-typescript/ts-reset";
import "@total-typescript/ts-reset/dom";

const MPV_CODE_BLOCK_START: string = "mpv_link";
const DEFAULT_TIMESTAMP = "00:00:00";
const BUTTON_LINK_ATTR = "link";
const LOGINFO: boolean = false;

function log(msg: string | number | object) {
	if (LOGINFO) {
		console.log(msg);
	}
}

export class ErrorModal extends Modal {
	message: string;

	constructor(app: App, message: string) {
		super(app);
		this.message = message;
	}

	onOpen() {
		const {contentEl} = this;
		const messageEl = contentEl.createEl("p", {text: this.message, cls: "error-message"});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}



const LUA_SCRIPT_CONTENT = `
local mp = require 'mp'

local function end_file(data)
    local timestamp = mp.get_property("time-pos")
    if timestamp then
        local hours = math.floor(timestamp / 3600)
        local minutes = math.floor((timestamp % 3600) / 60)
        local seconds = math.floor(timestamp % 60)
        io.write(string.format("[ %02d:%02d:%02d ]\\n", hours, minutes, seconds))
    end
    io.flush()
end


mp.add_hook('on_unload', 50, end_file)
`;


import * as os from 'os';
import * as fs from 'fs';
import {exec} from 'child_process';

function matchOrDefault(str: string, regex: RegExp, defaultStr: string): string {
	let match = str.match(regex);
	if (match != null && match[0] != null) {
		return match[0];
	}
	return defaultStr;
}

// Function to create a temporary Lua script file
function getLuaScriptPath(): string {
	const tempDir = os.tmpdir();
	const luaScriptPath = path.join(tempDir, 'capture_timestamp.lua');
	fs.writeFileSync(luaScriptPath, LUA_SCRIPT_CONTENT);
	return luaScriptPath;
}

function extractLastTimestamp(stdout: string): string {
	const basicTimeRegexForMPV = /\[ \d\d:\d\d:\d\d ]/g;
	let timeRegex = /\d\d:\d\d:\d\d/g;


	let lastTimestamp = DEFAULT_TIMESTAMP;
	log({timestampBasicExtract: stdout.match(basicTimeRegexForMPV)})

	lastTimestamp = matchOrDefault(stdout, basicTimeRegexForMPV, lastTimestamp);
	lastTimestamp = matchOrDefault(lastTimestamp, timeRegex, lastTimestamp);


	return lastTimestamp;
}

function getStartTimestamp(button: HTMLButtonElement): string {
	return button.innerText.split("/")[1] ?? DEFAULT_TIMESTAMP;
}

function openVideoAtTime(filePath: string, button: HTMLButtonElement) {
	const startTimestamp = getStartTimestamp(button);


	const command = `mpv --start=${startTimestamp} --script=${getLuaScriptPath()} "${filePath}"`;

	exec(command, async (error, stdout, stderr) => {
		if (error) {
			console.error(`exec error: ${error}`);
			new ErrorModal(this.app, error.message).open();
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		log({stdout, stderr});
		log({timestamp: extractLastTimestamp(stdout)});
		if (view) {
			const newTimestamp = extractLastTimestamp(stdout);
			if (newTimestamp) {
				const file = this.app.workspace.getActiveFile();
				const activeFileContent = await this.app.vault.read(file);
				const originalLink = button.getAttribute(BUTTON_LINK_ATTR)!;
				const newLink = originalLink.replace(startTimestamp, newTimestamp);
				const newMarkdown = activeFileContent.replace(originalLink, newLink);

				await this.app.vault.modify(file, newMarkdown);
				log(stdout);
			}
		}
	});
}

function extractDetails(input: string): { filepath: string; timestamp: string } {
	const videoLinkRegex = /\[\[\d+#video:(.+?)#(.+?)]]/;
	const match = input.match(videoLinkRegex);

	return match && match[1] && match[2]
		? {filepath: match[1], timestamp: match[2]}
		: {filepath: "/", timestamp: DEFAULT_TIMESTAMP};
}

function createButtonsFromMarkdown(markdown: string, container: HTMLElement): void {
	const regex = /\[\[\d*#video:.*:\d\d]]/g;
	let match;

	while ((match = regex.exec(markdown))) {
		let video_link = "";
		if (match[0]) {
			video_link = match[0];
		}
		const details = extractDetails(video_link);
		const fileName = details.filepath.split("/").pop();
		const button = container.createEl("button");

		button.setAttribute(BUTTON_LINK_ATTR, video_link);
		button.textContent = `Open Video at ${details.timestamp}`;
		button.innerText = `${fileName}/${details.timestamp}`;
		button.onclick = () => openVideoAtTime(details.filepath, button);
	}
}

function formatFilepathToVideoLink(filePath: string): string {
	const uniqueId = Date.now().toString();
	return `\n\`\`\` ${MPV_CODE_BLOCK_START} \n[[${uniqueId}#video:${filePath}#${DEFAULT_TIMESTAMP}]]\n\`\`\``;
}


import {App, Modal} from "obsidian";

const {dialog} = require('electron').remote;

export class FileSelectModal extends Modal {
	onSelect: (filePaths: string[]) => void;
	startDirectory: string;

	constructor(app: App, startDirectory: string, onSelect: (filePaths: string[]) => void) {
		super(app);
		this.startDirectory = startDirectory;
		this.onSelect = onSelect;
	}

	async onOpen() {
		const result = await dialog.showOpenDialog({
			title: "Select Video Files",
			defaultPath: this.startDirectory,
			properties: ["openFile", "multiSelections"],
			filters: [{name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov']}, {
				name: 'All Files',
				extensions: ['*']
			}]
		});

		if (!result.canceled && result.filePaths.length > 0) {
			this.onSelect(result.filePaths);
		}
		this.close();
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

import * as path from 'path';


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
