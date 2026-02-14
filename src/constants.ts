// Shared constants across the plugin

// Video file extensions (without dots, for Electron dialog filters)
export const VIDEO_EXTENSIONS_NO_DOT = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v'];

// Video file extensions (with dots, for file system matching)
export const VIDEO_EXTENSIONS = VIDEO_EXTENSIONS_NO_DOT.map(ext => `.${ext}`);

// Markdown code block identifier
export const MPV_CODE_BLOCK_START = "mpv_link";

// Default timestamp for new links
export const DEFAULT_TIMESTAMP = "00:00:00";

// Button attribute for storing link data
export const BUTTON_LINK_ATTR = "link";

// Enable logging
export const LOGINFO = true;
