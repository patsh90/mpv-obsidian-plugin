
function matchOrDefault(str: string, regex: RegExp, defaultStr: string): string {
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

// Function to create a temporary Lua script file
export function getLuaScriptPath(): string {
    const tempDir = os.tmpdir();
    const luaScriptPath = path.join(tempDir, 'capture_timestamp.lua');
    fs.writeFileSync(luaScriptPath, LUA_SCRIPT_CONTENT);
    return luaScriptPath;
}

export function log(msg: string | number | object) {
    if (LOGINFO) {
        console.log(msg);
    }
}

