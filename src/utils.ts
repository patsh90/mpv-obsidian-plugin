
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

local function end_file(data)
    local timestamp = mp.get_property("time-pos")
    if timestamp then
        local hours = math.floor(timestamp / 3600)
        local minutes = math.floor((timestamp % 3600) / 60)
        local seconds = math.floor(timestamp % 60)
        io.write(string.format("[ %02d:%02d:%02d ]\\n", hours, minutes, seconds))
    end
    io.flush()
end


mp.add_hook('on_unload', 50, end_file)
`;

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { LOGINFO } from './main';

/**
 * Creates a temporary Lua script file used to capture timestamps from MPV
 * The script is saved to the system's temp directory and contains code
 * that hooks into MPV's on_unload event to output the last playback position
 * @returns The absolute path to the created Lua script file
 */
export function getLuaScriptPath(): string {
    const tempDir = os.tmpdir();
    const luaScriptPath = path.join(tempDir, 'capture_timestamp.lua');
    fs.writeFileSync(luaScriptPath, LUA_SCRIPT_CONTENT);
    return luaScriptPath;
}

/**
 * Conditionally logs messages to the console based on the LOGINFO flag
 * @param msg - The message to log (string, number, or object)
 */
export function log(msg: string | number | object) {
    if (LOGINFO) {
        console.log(msg);
    }
}

