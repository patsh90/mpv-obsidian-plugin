import { App, Modal } from "obsidian";

export type MessageType = "info" | "error" | "success";

export class MessageModal extends Modal {
	private message: string;
	private type: MessageType;

	constructor(app: App, message: string, type: MessageType = "info") {
		super(app);
		this.message = message;
		this.type = type;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("p", {
			text: this.message,
			cls: `message-modal message-modal-${this.type}`
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
