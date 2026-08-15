import { App, Modal } from "obsidian";
import { dialog } from '@electron/remote';
import { VIDEO_EXTENSIONS_NO_DOT } from "../constants";

export type PathSelectMode = "file" | "folder";

function dialogProperties(mode: PathSelectMode, multiSelect: boolean): Array<"openFile" | "openDirectory" | "multiSelections"> {
	if (mode === "folder") {
		return ["openDirectory"];
	}
	if (multiSelect) {
		return ["openFile", "multiSelections"];
	}
	return ["openFile"];
}

const VIDEO_FILTERS = [
	{ name: 'Videos', extensions: VIDEO_EXTENSIONS_NO_DOT },
	{ name: 'All Files', extensions: ['*'] },
];

export class PathSelectModal extends Modal {
	private onSelect: (paths: string[]) => void | Promise<void>;
	private startDirectory: string;
	private mode: PathSelectMode;
	private multiSelect: boolean;

	constructor(
		app: App,
		startDirectory: string,
		mode: PathSelectMode,
		onSelect: (paths: string[]) => void | Promise<void>,
		multiSelect = false
	) {
		super(app);
		this.startDirectory = startDirectory;
		this.mode = mode;
		this.onSelect = onSelect;
		this.multiSelect = multiSelect;
	}

	onOpen(): void {
		void this.showDialog();
	}

	private async showDialog(): Promise<void> {
		const isFolderSelection = this.mode === "folder";
		const filters = isFolderSelection ? undefined : VIDEO_FILTERS;
		const title = isFolderSelection ? "Select folder to scan for videos" : "Select video files";

		const result = await dialog.showOpenDialog({
			title,
			defaultPath: this.startDirectory,
			properties: dialogProperties(this.mode, this.multiSelect),
			filters,
		});

		if (!result.canceled && result.filePaths.length > 0) {
			await this.onSelect(result.filePaths);
		}
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
