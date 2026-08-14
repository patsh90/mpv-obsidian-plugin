import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { App } from 'obsidian';
import { LOGINFO } from './constants';

/**
 * Attempts to match a regex pattern in a string and returns the match or a default value
 * @param str - The input string to search
 * @param regex - Regular expression pattern to match
 * @param defaultStr - Default string to return if no match is found
 * @returns The matched string or default value
 */
export function matchOrDefault(str: string, regex: RegExp, defaultStr: string): string {
	const match = str.match(regex);
	return match?.[0] ?? defaultStr;
}

export const LUA_SCRIPT_CONTENT = `
local mp = require 'mp'

local function formatTime(seconds)
    local hours = math.floor(seconds / 3600)
    local minutes = math.floor((seconds % 3600) / 60)
    local secs = math.floor(seconds % 60)
    return string.format("%02d:%02d:%02d", hours, minutes, secs)
end

local function end_file(data)
    local timestamp = mp.get_property("time-pos")
    local duration = mp.get_property("duration")
    if timestamp then
        local timestampStr = formatTime(timestamp)
        local durationStr = duration and formatTime(duration) or "00:00:00"
        io.write(string.format("[ %s / %s ]\\n", timestampStr, durationStr))
    end
    io.flush()
end


mp.add_hook('on_unload', 50, end_file)
`;

/**
 * Gets the vault's base path from the Obsidian app instance
 * @param app - The Obsidian App instance
 * @returns The absolute path to the vault root
 */
export function getVaultBasePath(app: App): string {
	// FileSystemAdapter has basePath but it's not in the public API
	return (app.vault.adapter as { basePath: string }).basePath;
}

/**
 * Converts an absolute path to a vault-relative path with forward slashes
 * @param absolutePath - The absolute file path to convert
 * @param vaultBasePath - The base path of the Obsidian vault
 * @returns A relative path using forward slashes for cross-platform storage
 */
export function toVaultRelativePath(absolutePath: string, vaultBasePath: string): string {
	const relativePath = path.relative(vaultBasePath, absolutePath);
	// Use forward slashes for consistent storage across platforms
	return relativePath.replace(/\\/g, '/');
}

/**
 * Resolves a stored path (possibly relative) to an absolute path for mpv
 * @param storedPath - The path as stored in markdown (may be relative or absolute)
 * @param vaultBasePath - The base path of the Obsidian vault
 * @returns The absolute path suitable for mpv execution
 */
export function resolveToAbsolutePath(storedPath: string, vaultBasePath: string): string {
	// Convert forward slashes to platform-specific before checking
	const platformPath = storedPath.replace(/\//g, path.sep);
	if (path.isAbsolute(platformPath)) {
		return platformPath;
	}
	return path.resolve(vaultBasePath, platformPath);
}

/**
 * Creates a temporary Lua script file used to capture timestamps from MPV
 * The script is saved to the system's temp directory and contains code
 * that hooks into MPV's on_unload event to output the last playback position
 * @returns The absolute path to the created Lua script file
 */
export function getLuaScriptPath(): string {
	const tempDir = os.tmpdir();
	const luaScriptPath = path.join(tempDir, 'capture_timestamp.lua');
	try {
		fs.writeFileSync(luaScriptPath, LUA_SCRIPT_CONTENT);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to write Lua script to temp directory: ${detail}`);
	}
	return luaScriptPath;
}

/**
 * Conditionally logs messages to the console based on the LOGINFO flag
 * @param msg - The message to log (string, number, or object)
 */
export function log(msg: string | number | object): void {
	if (LOGINFO) {
		console.log(msg);
	}
}
