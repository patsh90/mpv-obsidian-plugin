import { mock, describe, test, expect, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';

// mock.module must be called before the dynamic import of utils so that
// `import { App } from 'obsidian'` inside utils.ts resolves to the stub.
mock.module('obsidian', () => ({}));

const { getLuaScriptPath, LUA_SCRIPT_CONTENT } = await import('./utils');

// ============================================================================
// getLuaScriptPath tests
//
// Bug being fixed: getLuaScriptPath() is called BEFORE the try/catch in
// openVideoAtTime. When fs.writeFileSync throws (full disk, permissions),
// the error propagates uncaught — the plugin crashes with no user feedback.
//
// Two-part fix:
//   1. getLuaScriptPath wraps the raw fs error with a descriptive message.
//   2. The call site moves inside the try block so the error is caught.
// ============================================================================

describe("getLuaScriptPath", () => {
	// --- Happy path ---

	test("returns a path ending in 'capture_timestamp.lua'", () => {
		const result = getLuaScriptPath();
		expect(result.endsWith('capture_timestamp.lua')).toBe(true);
	});

	test("returned path is inside the system temp directory", () => {
		const result = getLuaScriptPath();
		expect(result.startsWith(os.tmpdir())).toBe(true);
	});

	test("creates the file at the returned path", () => {
		const result = getLuaScriptPath();
		expect(fs.existsSync(result)).toBe(true);
	});

	test("written file contains the Lua script content", () => {
		const result = getLuaScriptPath();
		const content = fs.readFileSync(result, 'utf8');
		expect(content).toBe(LUA_SCRIPT_CONTENT);
	});

	// --- Error handling bug case ---
	//
	// Currently: raw fs error propagates with e.g. "ENOSPC: no space left"
	//   → caller sees a meaningless system message (or nothing, if uncaught)
	//
	// After fix: error is wrapped so callers see something like:
	//   "Failed to write Lua script to temp directory: ENOSPC: no space left"
	//
	// This test is in RED state with the current code because no wrapping occurs.

	test("wraps writeFileSync errors with a descriptive message", () => {
		const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {
			throw new Error('ENOSPC: no space left on device');
		});

		try {
			expect(() => getLuaScriptPath()).toThrow(/Failed to write Lua script/);
		} finally {
			writeSpy.mockRestore();
		}
	});
});
