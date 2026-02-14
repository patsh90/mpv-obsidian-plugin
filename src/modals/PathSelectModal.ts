import { App, Modal } from "obsidian";
import { dialog } from '@electron/remote';
import { VIDEO_EXTENSIONS_NO_DOT } from "../constants";

export type PathSelectMode = "file" | "folder";

export class PathSelectModal extends Modal {
	private onSelect: (paths: string[]) => void;
	private startDirectory: string;
	private mode: PathSelectMode;
	private multiSelect: boolean;

	constructor(
		app: App,
		startDirectory: string,
		mode: PathSelectMode,
		onSelect: (paths: string[]) => void,
		multiSelect: boolean = false
	) {
		super(app);
		this.startDirectory = startDirectory;
		this.mode = mode;
		this.onSelect = onSelect;
		this.multiSelect = multiSelect;
	}

	async onOpen(): Promise<void> {
		const properties: Array<"openFile" | "openDirectory" | "multiSelections"> =
			this.mode === "folder"
				? ["openDirectory"]
				: this.multiSelect
					? ["openFile", "multiSelections"]
					: ["openFile"];

		const filters = this.mode === "file"
			? [
				{ name: 'Videos', extensions: VIDEO_EXTENSIONS_NO_DOT },
				{ name: 'All Files', extensions: ['*'] }
			]
			: undefined;

		const title = this.mode === "folder"
			? "Select folder to scan for videos"
			: "Select video files";

		const result = await dialog.showOpenDialog({
			title,
			defaultPath: this.startDirectory,
			properties,
			filters
		});

		if (!result.canceled && result.filePaths.length > 0) {
			this.onSelect(result.filePaths);
		}
		this.close();
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
