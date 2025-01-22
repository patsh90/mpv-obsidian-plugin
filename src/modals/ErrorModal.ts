import { App, Modal } from "obsidian";

export class ErrorModal extends Modal {
	message: string;

	constructor(app: App, message: string) {
		super(app);
		this.message = message;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("p", { text: this.message, cls: "error-message" });
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}