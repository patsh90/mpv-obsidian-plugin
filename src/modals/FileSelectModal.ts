import { App, Modal } from "obsidian";

import { dialog } from '@electron/remote';

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
			title: "Select video files",
			defaultPath: this.startDirectory,
			properties: ["openFile", "multiSelections"],
			filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov'] }, {
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
		const { contentEl } = this;
		contentEl.empty();
	}
}
