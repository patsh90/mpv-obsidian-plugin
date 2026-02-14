// Type definitions for the plugin

export interface MpvLinksSettings {
	rememberLastFolder: boolean;
	lastFolderPath: string;
	enableHashRelocalization: boolean;
	endBufferSeconds: number;
}

export const DEFAULT_SETTINGS: MpvLinksSettings = {
	rememberLastFolder: false,
	lastFolderPath: "",
	enableHashRelocalization: false,
	endBufferSeconds: 5,
};

export interface VideoLinkDetails {
	filepath: string;
	timestamp: string;
	isFixed: boolean;
	hash?: string;
	size?: number;
}
