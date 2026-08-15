import { App, Modal } from "obsidian";

export interface ProgressUpdate {
	phase: string;
	current: number;
	total: number;
	detail?: string;
}

export class ProgressModal extends Modal {
	private title: string;
	private progressEl: HTMLDivElement | null = null;
	private fillEl: HTMLDivElement | null = null;
	private percentEl: HTMLSpanElement | null = null;
	private statusEl: HTMLDivElement | null = null;
	private detailEl: HTMLDivElement | null = null;
	private cancelCallback: (() => void) | null = null;
	private cancelled = false;

	constructor(app: App, title: string, onCancel?: () => void) {
		super(app);
		this.title = title;
		this.cancelCallback = onCancel ?? null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("progress-modal");

		contentEl.createEl("h3", { text: this.title });

		const progressContainer = contentEl.createDiv({ cls: "progress-modal-container" });

		this.progressEl = progressContainer.createDiv({ cls: "progress-modal-bar" });
		this.fillEl = this.progressEl.createDiv({ cls: "progress-modal-fill" });
		this.fillEl.setCssProps({ '--progress-fill-width': '0%' });

		this.percentEl = progressContainer.createSpan({ cls: "progress-modal-percent", text: "0%" });

		this.statusEl = contentEl.createDiv({ cls: "progress-modal-status" });
		this.statusEl.setText("Initializing...");

		this.detailEl = contentEl.createDiv({ cls: "progress-modal-detail" });

		const buttonContainer = contentEl.createDiv({ cls: "progress-modal-buttons" });
		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.handleCancel());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}

	private handleCancel(): void {
		this.cancelled = true;
		this.cancelCallback?.();
		this.close();
	}

	/**
	 * Update the progress display
	 * @param progress - Progress update with phase, current, total, and optional detail
	 */
	updateProgress(progress: ProgressUpdate): void {
		const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

		if (this.fillEl) {
			this.fillEl.setCssProps({ '--progress-fill-width': `${percent}%` });
		}
		if (this.percentEl) {
			this.percentEl.setText(`${percent}%`);
		}
		if (this.statusEl) {
			this.statusEl.setText(progress.phase);
		}
		if (this.detailEl && progress.detail) {
			this.detailEl.setText(progress.detail);
		}
	}

	/**
	 * Set the status text
	 */
	setStatus(status: string): void {
		if (this.statusEl) {
			this.statusEl.setText(status);
		}
	}

	/**
	 * Set the detail text
	 */
	setDetail(detail: string): void {
		if (this.detailEl) {
			this.detailEl.setText(detail);
		}
	}

	/**
	 * Check if the operation was cancelled
	 */
	isCancelled(): boolean {
		return this.cancelled;
	}
}
