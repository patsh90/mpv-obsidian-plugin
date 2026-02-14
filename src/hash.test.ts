import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { calculatePartialMD5 } from './hash';

// ============================================================================
// calculatePartialMD5 tests
//
// Bug being fixed: the function opens a file handle with fs.promises.open then
// calls fh.read and fh.close sequentially. If fh.read throws
// (e.g. OS error mid-read), fh.close is never reached and the file
// handle is leaked. After many such failures the process hits the OS fd
// limit ("too many open files") and all subsequent file operations fail.
//
// Fix: wrap the read in try/finally so fh.close always runs.
// ============================================================================

describe("calculatePartialMD5", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpv-hash-test-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- Happy path ---

	test("returns a 32-character lowercase hex string", async () => {
		const file = path.join(tmpDir, 'video.mp4');
		fs.writeFileSync(file, 'some video bytes');
		const hash = await calculatePartialMD5(file);
		expect(hash).toMatch(/^[a-f0-9]{32}$/);
	});

	test("is deterministic — same file content produces same hash", async () => {
		const file = path.join(tmpDir, 'video.mp4');
		fs.writeFileSync(file, 'consistent content for hashing');
		expect(await calculatePartialMD5(file)).toBe(await calculatePartialMD5(file));
	});

	test("produces different hashes for different file content", async () => {
		const fileA = path.join(tmpDir, 'a.mp4');
		const fileB = path.join(tmpDir, 'b.mp4');
		fs.writeFileSync(fileA, 'content alpha');
		fs.writeFileSync(fileB, 'content beta');
		expect(await calculatePartialMD5(fileA)).not.toBe(await calculatePartialMD5(fileB));
	});

	test("works on an empty file (zero-byte edge case)", async () => {
		const file = path.join(tmpDir, 'empty.mp4');
		fs.writeFileSync(file, '');
		const hash = await calculatePartialMD5(file);
		expect(hash).toMatch(/^[a-f0-9]{32}$/);
	});

	// --- File handle leak bug case ---
	//
	// Simulate an OS-level read failure by mocking fs.promises.open to return
	// a fake FileHandle whose read() throws. With the current code the sequence is:
	//   fh = await fs.promises.open(...)
	//   await fh.read(...)   ← throws here
	//   await fh.close()     ← NEVER REACHED → handle leaked
	//
	// After the fix (try/finally), fh.close() must be called regardless.

	test("closes the file handle even when read throws", async () => {
		const file = path.join(tmpDir, 'video.mp4');
		fs.writeFileSync(file, 'content');

		let closeCalled = false;
		const fakeHandle = {
			read: () => { throw new Error('simulated OS read error'); },
			close: () => { closeCalled = true; return Promise.resolve(); },
		};

		const openSpy = spyOn(fs.promises, 'open').mockResolvedValue(fakeHandle as unknown as Awaited<ReturnType<typeof fs.promises.open>>);

		await expect(calculatePartialMD5(file)).rejects.toThrow('simulated OS read error');
		expect(closeCalled).toBe(true);

		openSpy.mockRestore();
	});
});
