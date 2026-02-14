import { describe, expect, test } from "bun:test";
import { extractDetails, isLinkFixed, VIDEO_LINK_REGEX, replaceTimestampInLink, replaceAllLinkOccurrences, timestampToSeconds, extractTimestampInfo } from "./link-parser";
import { buildMpvArgs } from "./mpv-command";

// ============================================================================
// buildMpvArgs tests
//
// Security contract: buildMpvArgs must return a plain string[] that can be
// passed to execFile() instead of exec(). Because execFile does NOT spawn a
// shell, every element in the array is handed verbatim to the OS — so shell
// metacharacters in timestamps or file paths are never interpreted.
// ============================================================================

describe("buildMpvArgs", () => {
	// --- Happy path ---

	test("returns exactly 3 elements", () => {
		const args = buildMpvArgs("01:23:45", "/tmp/capture.lua", "/videos/movie.mp4");
		expect(args.length).toBe(3);
	});

	test("first arg encodes start timestamp as --start=", () => {
		const args = buildMpvArgs("01:23:45", "/tmp/capture.lua", "/videos/movie.mp4");
		expect(args[0]).toBe("--start=01:23:45");
	});

	test("second arg encodes lua path as --script=", () => {
		const args = buildMpvArgs("01:23:45", "/tmp/capture.lua", "/videos/movie.mp4");
		expect(args[1]).toBe("--script=/tmp/capture.lua");
	});

	test("third arg is the bare video path", () => {
		const args = buildMpvArgs("01:23:45", "/tmp/capture.lua", "/videos/movie.mp4");
		expect(args[2]).toBe("/videos/movie.mp4");
	});

	// --- Spaces in paths (would break an unquoted shell string) ---

	test("video path with spaces is a single arg, not split", () => {
		const args = buildMpvArgs("00:00:00", "/tmp/capture.lua", "/my videos/holiday footage.mp4");
		expect(args[2]).toBe("/my videos/holiday footage.mp4");
		expect(args.length).toBe(3);
	});

	test("lua script path with spaces is passed verbatim inside --script=", () => {
		const args = buildMpvArgs("00:00:00", "/tmp dir/capture timestamp.lua", "/video.mp4");
		expect(args[1]).toBe("--script=/tmp dir/capture timestamp.lua");
		expect(args.length).toBe(3);
	});

	// --- Injection payloads (must appear as literals; shell never sees them) ---

	test("semicolon injection in timestamp appears verbatim in --start=", () => {
		// If this were exec(), "; rm -rf /" would be a second shell command.
		// With execFile() it's just a weird --start= value mpv rejects gracefully.
		const malicious = "00:00:00; rm -rf /";
		const args = buildMpvArgs(malicious, "/tmp/capture.lua", "/video.mp4");
		expect(args[0]).toBe(`--start=${malicious}`);
	});

	test("subshell injection in timestamp appears verbatim in --start=", () => {
		const malicious = "$(malicious_command)";
		const args = buildMpvArgs(malicious, "/tmp/capture.lua", "/video.mp4");
		expect(args[0]).toBe(`--start=${malicious}`);
	});

	test("subshell injection in video path appears verbatim as third arg", () => {
		const maliciousPath = "/videos/$(cat /etc/passwd).mp4";
		const args = buildMpvArgs("00:00:00", "/tmp/capture.lua", maliciousPath);
		expect(args[2]).toBe(maliciousPath);
	});

	test("ampersand injection in video path appears verbatim as third arg", () => {
		const maliciousPath = "/videos/movie.mp4 && curl evil.com";
		const args = buildMpvArgs("00:00:00", "/tmp/capture.lua", maliciousPath);
		expect(args[2]).toBe(maliciousPath);
	});

	test("backtick injection in lua path appears verbatim inside --script=", () => {
		const maliciousLua = "/tmp/`id`.lua";
		const args = buildMpvArgs("00:00:00", maliciousLua, "/video.mp4");
		expect(args[1]).toBe(`--script=${maliciousLua}`);
	});

	// --- Zero-time edge case ---

	test("default zero timestamp 00:00:00 produces correct --start= arg", () => {
		const args = buildMpvArgs("00:00:00", "/tmp/capture.lua", "/video.mp4");
		expect(args[0]).toBe("--start=00:00:00");
	});
});

// ============================================================================
// timestampToSeconds tests
//
// Bug being fixed: `.map(Number)` turns non-numeric segments into NaN.
// `NaN ?? 0` does NOT fall back to 0 because NaN is not null/undefined.
// So inputs like "aa:bb:cc" or "01:xx:45" silently return NaN, which
// then propagates through the end-buffer arithmetic in updateTimestampInMarkdown,
// causing the buffer cap to be silently skipped.
// ============================================================================

describe("timestampToSeconds", () => {
	// --- Happy path (these pass already; they establish the contract) ---

	test("converts 00:00:00 to 0", () => {
		expect(timestampToSeconds("00:00:00")).toBe(0);
	});

	test("converts 00:00:01 to 1", () => {
		expect(timestampToSeconds("00:00:01")).toBe(1);
	});

	test("converts 00:01:00 to 60", () => {
		expect(timestampToSeconds("00:01:00")).toBe(60);
	});

	test("converts 01:00:00 to 3600", () => {
		expect(timestampToSeconds("01:00:00")).toBe(3600);
	});

	test("converts 01:23:45 to 5025", () => {
		expect(timestampToSeconds("01:23:45")).toBe(5025);
	});

	test("converts 99:59:59 to 359999", () => {
		expect(timestampToSeconds("99:59:59")).toBe(359999);
	});

	// --- NaN propagation bug cases (these currently FAIL, returning NaN) ---
	//
	// Behaviour required: any non-numeric segment must return 0, not NaN.
	// NaN returned here propagates into: maxTimestamp = durationSeconds - buffer,
	// then `timestampSeconds > maxTimestamp` evaluates to false (NaN comparison)
	// so the buffer cap is silently skipped.

	test("returns 0 (not NaN) for fully non-numeric input 'aa:bb:cc'", () => {
		const result = timestampToSeconds("aa:bb:cc");
		expect(result).toBe(0);
		expect(Number.isNaN(result)).toBe(false);
	});

	test("returns 0 (not NaN) when one segment is non-numeric '01:xx:45'", () => {
		const result = timestampToSeconds("01:xx:45");
		expect(result).toBe(0);
		expect(Number.isNaN(result)).toBe(false);
	});

	test("returns 0 (not NaN) when seconds segment is non-numeric '00:00:aa'", () => {
		const result = timestampToSeconds("00:00:aa");
		expect(result).toBe(0);
		expect(Number.isNaN(result)).toBe(false);
	});

	test("returns 0 (not NaN) for empty string", () => {
		// "".split(':') → [""], length 1, early-return path — also must not NaN
		const result = timestampToSeconds("");
		expect(result).toBe(0);
		expect(Number.isNaN(result)).toBe(false);
	});

	test("returns 0 for wrong number of segments '01:23'", () => {
		expect(timestampToSeconds("01:23")).toBe(0);
	});
});

// ============================================================================
// extractTimestampInfo tests
//
// Bug being fixed: the regex \d{2}:\d{2}:\d{2} matches any two-digit number
// in each position, including impossible values like 99 minutes or 99 seconds.
// Such values pass straight through into the note as stored timestamps.
// Validation rule: minutes and seconds must be 0–59. Hours are unbounded
// (long recordings can exceed 24 h). Any out-of-range value → DEFAULT_TIMESTAMP.
// ============================================================================

describe("extractTimestampInfo", () => {
	// --- Happy path ---

	test("extracts timestamp and duration from valid mpv output", () => {
		const result = extractTimestampInfo("[ 01:23:45 / 02:00:00 ]");
		expect(result.timestamp).toBe("01:23:45");
		expect(result.duration).toBe("02:00:00");
	});

	test("returns DEFAULT_TIMESTAMP when stdout has no match", () => {
		const result = extractTimestampInfo("mpv error: file not found");
		expect(result.timestamp).toBe("00:00:00");
		expect(result.duration).toBeUndefined();
	});

	test("returns DEFAULT_TIMESTAMP for empty string", () => {
		expect(extractTimestampInfo("").timestamp).toBe("00:00:00");
	});

	test("extracts from multi-line stdout containing the marker", () => {
		const stdout = "Opening file...\n[ 00:30:00 / 01:00:00 ]\nDone.";
		const result = extractTimestampInfo(stdout);
		expect(result.timestamp).toBe("00:30:00");
		expect(result.duration).toBe("01:00:00");
	});

	test("accepts hours ≥ 24 (long recordings are valid)", () => {
		const result = extractTimestampInfo("[ 99:00:00 / 99:30:00 ]");
		expect(result.timestamp).toBe("99:00:00");
	});

	// --- Impossible value bug cases (currently FAIL — values pass through) ---
	//
	// Minutes or seconds ≥ 60 cannot represent a real playback position.
	// Storing them corrupts the note; mpv won't seek to a valid position.

	test("returns DEFAULT_TIMESTAMP when timestamp minutes are ≥ 60", () => {
		// "01:60:00" — 60 minutes is not a valid clock value
		const result = extractTimestampInfo("[ 01:60:00 / 02:00:00 ]");
		expect(result.timestamp).toBe("00:00:00");
	});

	test("returns DEFAULT_TIMESTAMP when timestamp seconds are ≥ 60", () => {
		// "01:23:99" — 99 seconds is not a valid clock value
		const result = extractTimestampInfo("[ 01:23:99 / 02:00:00 ]");
		expect(result.timestamp).toBe("00:00:00");
	});

	test("returns DEFAULT_TIMESTAMP when duration minutes are ≥ 60", () => {
		// A bad duration should also be rejected to protect the buffer math
		const result = extractTimestampInfo("[ 01:00:00 / 01:99:00 ]");
		expect(result.timestamp).toBe("00:00:00");
	});

	test("returns DEFAULT_TIMESTAMP when duration seconds are ≥ 60", () => {
		const result = extractTimestampInfo("[ 01:00:00 / 01:00:99 ]");
		expect(result.timestamp).toBe("00:00:00");
	});

	test("returns DEFAULT_TIMESTAMP for the maximally bad value 99:99:99", () => {
		const result = extractTimestampInfo("[ 99:99:99 / 99:99:99 ]");
		expect(result.timestamp).toBe("00:00:00");
	});
});

// ============================================================================
// replaceTimestampInLink tests
//
// Bug being fixed: originalLink.replace(cleanTimestamp, newTimestamp) was used
// which (a) replaces the first match anywhere in the string, so a timestamp-
// like substring in the filename gets hit instead of the structural timestamp,
// and (b) String.replace with a string arg only replaces the first occurrence.
// ============================================================================

describe("replaceTimestampInLink", () => {
	// --- Happy path ---

	test("replaces timestamp in a standard link", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/path/video.mp4#01:23:45]]",
			"02:34:56"
		);
		expect(result).toBe("[[123#video:/path/video.mp4#02:34:56]]");
	});

	test("replaces timestamp in a fixed link and preserves the fixed marker", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/path/video.mp4#01:23:45#]]",
			"02:34:56"
		);
		expect(result).toBe("[[123#video:/path/video.mp4#02:34:56#]]");
	});

	test("replaces timestamp in a link with hash metadata and preserves hash", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/path/video.mp4#01:23:45#hash:abc123]]",
			"02:34:56"
		);
		expect(result).toBe("[[123#video:/path/video.mp4#02:34:56#hash:abc123]]");
	});

	test("replaces timestamp in a fixed link with hash and preserves both markers", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/path/video.mp4#01:23:45##hash:abc123]]",
			"02:34:56"
		);
		expect(result).toBe("[[123#video:/path/video.mp4#02:34:56##hash:abc123]]");
	});

	test("replaces timestamp when link has hash and size metadata", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/path/video.mp4#01:23:45#hash:abc#size:9999]]",
			"02:34:56"
		);
		expect(result).toBe("[[123#video:/path/video.mp4#02:34:56#hash:abc#size:9999]]");
	});

	// --- Key bug case: timestamp-like substring in the filename ---
	//
	// Old code: originalLink.replace("01:23:45", "02:34:56")
	// This would hit the "01:23:45" in the filename first, producing:
	//   [[123#video:/clips/02:34:56_intro.mp4#01:23:45]]  ← WRONG
	//
	// New function must leave the path untouched and replace only the
	// structural timestamp (preceded by # and followed by # or ]).

	test("does NOT corrupt path when filename contains the same timestamp string", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/clips/01:23:45_intro.mp4#01:23:45]]",
			"02:34:56"
		);
		// Path must be unchanged; only the structural timestamp is replaced.
		expect(result).toBe("[[123#video:/clips/01:23:45_intro.mp4#02:34:56]]");
	});

	test("does NOT corrupt path when directory name contains the same timestamp", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/01:23:45/video.mp4#01:23:45]]",
			"00:00:05"
		);
		expect(result).toBe("[[123#video:/01:23:45/video.mp4#00:00:05]]");
	});

	// --- Default/zero timestamp ---

	test("replaces the default 00:00:00 timestamp", () => {
		const result = replaceTimestampInLink(
			"[[123#video:/path/video.mp4#00:00:00]]",
			"01:05:30"
		);
		expect(result).toBe("[[123#video:/path/video.mp4#01:05:30]]");
	});
});

// ============================================================================
// replaceAllLinkOccurrences tests
//
// Bug being fixed: activeFileContent.replace(originalLink, newLink) was used
// which only updates the FIRST occurrence of the link in the document. If the
// same link block appears more than once, later ones are silently missed.
// ============================================================================

describe("replaceAllLinkOccurrences", () => {
	const LINK = "[[123#video:/path/video.mp4#01:23:45]]";
	const NEW_LINK = "[[123#video:/path/video.mp4#02:34:56]]";

	// --- Key bug case: multiple occurrences ---

	test("replaces ALL occurrences when the same link appears more than once", () => {
		const content = `Some text\n${LINK}\nMiddle text\n${LINK}\nEnd text`;
		const result = replaceAllLinkOccurrences(content, LINK, NEW_LINK);
		expect(result).toBe(`Some text\n${NEW_LINK}\nMiddle text\n${NEW_LINK}\nEnd text`);
		// Verify no old link remains
		expect(result).not.toContain(LINK);
	});

	test("replaces a single occurrence correctly", () => {
		const content = `Before\n${LINK}\nAfter`;
		const result = replaceAllLinkOccurrences(content, LINK, NEW_LINK);
		expect(result).toBe(`Before\n${NEW_LINK}\nAfter`);
	});

	test("returns content unchanged when link is not found", () => {
		const content = "No links here";
		const result = replaceAllLinkOccurrences(content, LINK, NEW_LINK);
		expect(result).toBe("No links here");
	});

	// --- Special characters in link must be treated literally ---
	//
	// `[` and `]` are regex metacharacters. String.replace(regex, ...) would
	// interpret them as a character class and fail. split/join avoids this.

	test("treats brackets in link string as literals, not regex metacharacters", () => {
		const linkWithBrackets = "[[999#video:/path/[2024] film.mp4#00:30:00]]";
		const updatedLink    = "[[999#video:/path/[2024] film.mp4#01:00:00]]";
		const content = `text ${linkWithBrackets} more text`;
		const result = replaceAllLinkOccurrences(content, linkWithBrackets, updatedLink);
		expect(result).toBe(`text ${updatedLink} more text`);
	});

	test("replaces three or more occurrences", () => {
		const content = `${LINK}\n${LINK}\n${LINK}`;
		const result = replaceAllLinkOccurrences(content, LINK, NEW_LINK);
		expect(result.split(NEW_LINK).length - 1).toBe(3);
		expect(result).not.toContain(LINK);
	});
});

// ============================================================================
// extractDetails tests
// ============================================================================

describe("extractDetails", () => {
	test("parses standard link", () => {
		const result = extractDetails("[[123#video:/path/to/video.mp4#01:23:45]]");
		expect(result.filepath).toBe("/path/to/video.mp4");
		expect(result.timestamp).toBe("01:23:45");
		expect(result.isFixed).toBe(false);
		expect(result.hash).toBeUndefined();
		expect(result.size).toBeUndefined();
	});

	test("parses fixed link", () => {
		const result = extractDetails("[[123#video:/path/to/video.mp4#01:23:45#]]");
		expect(result.filepath).toBe("/path/to/video.mp4");
		expect(result.timestamp).toBe("01:23:45");
		expect(result.isFixed).toBe(true);
		expect(result.hash).toBeUndefined();
		expect(result.size).toBeUndefined();
	});

	test("parses link with hash", () => {
		const result = extractDetails("[[123#video:/path/to/video.mp4#01:23:45#hash:abc123def456]]");
		expect(result.filepath).toBe("/path/to/video.mp4");
		expect(result.timestamp).toBe("01:23:45");
		expect(result.isFixed).toBe(false);
		expect(result.hash).toBe("abc123def456");
		expect(result.size).toBeUndefined();
	});

	test("parses fixed link with hash", () => {
		const result = extractDetails("[[123#video:/path/to/video.mp4#01:23:45##hash:abc123def456]]");
		expect(result.filepath).toBe("/path/to/video.mp4");
		expect(result.timestamp).toBe("01:23:45");
		expect(result.isFixed).toBe(true);
		expect(result.hash).toBe("abc123def456");
		expect(result.size).toBeUndefined();
	});

	test("parses link with hash and size", () => {
		const result = extractDetails("[[123#video:/path/to/video.mp4#01:23:45#hash:abc123#size:1234567890]]");
		expect(result.filepath).toBe("/path/to/video.mp4");
		expect(result.timestamp).toBe("01:23:45");
		expect(result.isFixed).toBe(false);
		expect(result.hash).toBe("abc123");
		expect(result.size).toBe(1234567890);
	});

	test("parses fixed link with hash and size", () => {
		const result = extractDetails("[[123#video:/path/to/video.mp4#01:23:45##hash:abc123#size:1234567890]]");
		expect(result.filepath).toBe("/path/to/video.mp4");
		expect(result.timestamp).toBe("01:23:45");
		expect(result.isFixed).toBe(true);
		expect(result.hash).toBe("abc123");
		expect(result.size).toBe(1234567890);
	});

	test("handles paths with special characters", () => {
		const result = extractDetails("[[123#video:/path/to/my-video_file (2024).mp4#00:00:00]]");
		expect(result.filepath).toBe("/path/to/my-video_file (2024).mp4");
		expect(result.timestamp).toBe("00:00:00");
	});

	test("handles paths with spaces", () => {
		const result = extractDetails("[[123#video:/path/with spaces/video file.mp4#00:00:00]]");
		expect(result.filepath).toBe("/path/with spaces/video file.mp4");
		expect(result.timestamp).toBe("00:00:00");
	});

	test("handles Windows-style paths", () => {
		const result = extractDetails("[[123#video:C:\\Users\\test\\Videos\\video.mp4#01:00:00]]");
		expect(result.filepath).toBe("C:\\Users\\test\\Videos\\video.mp4");
		expect(result.timestamp).toBe("01:00:00");
	});

	test("returns default values for invalid input", () => {
		const result = extractDetails("invalid input");
		expect(result.filepath).toBe("/");
		expect(result.timestamp).toBe("00:00:00");
		expect(result.isFixed).toBe(false);
	});
});

// ============================================================================
// isLinkFixed tests
// ============================================================================

describe("isLinkFixed", () => {
	test("returns false for standard link", () => {
		expect(isLinkFixed("[[123#video:/path/to/video.mp4#01:23:45]]")).toBe(false);
	});

	test("returns true for fixed link", () => {
		expect(isLinkFixed("[[123#video:/path/to/video.mp4#01:23:45#]]")).toBe(true);
	});

	test("returns false for link with hash (not fixed)", () => {
		// KEY: This is the bug case - link with hash should NOT be fixed
		expect(isLinkFixed("[[123#video:/path/to/video.mp4#01:23:45#hash:abc123]]")).toBe(false);
	});

	test("returns true for fixed link with hash", () => {
		expect(isLinkFixed("[[123#video:/path/to/video.mp4#01:23:45##hash:abc123]]")).toBe(true);
	});

	test("returns false for link with hash and size", () => {
		expect(isLinkFixed("[[123#video:/path/to/video.mp4#01:23:45#hash:abc#size:12345]]")).toBe(false);
	});

	test("returns true for fixed link with hash and size", () => {
		expect(isLinkFixed("[[123#video:/path/to/video.mp4#01:23:45##hash:abc#size:12345]]")).toBe(true);
	});
});

// ============================================================================
// VIDEO_LINK_REGEX tests
// ============================================================================

describe("VIDEO_LINK_REGEX", () => {
	test("matches standard link", () => {
		const matches = "[[123#video:/path/video.mp4#01:23:45]]".match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});

	test("matches fixed link", () => {
		const matches = "[[123#video:/path/video.mp4#01:23:45#]]".match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});

	test("matches link with hash", () => {
		const matches = "[[123#video:/path/video.mp4#01:23:45#hash:abc123]]".match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});

	test("matches fixed link with hash", () => {
		const matches = "[[123#video:/path/video.mp4#01:23:45##hash:abc123]]".match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});

	test("matches link with hash and size", () => {
		const matches = "[[123#video:/path/video.mp4#01:23:45#hash:abc#size:12345]]".match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});

	test("matches fixed link with hash and size", () => {
		const matches = "[[123#video:/path/video.mp4#01:23:45##hash:abc#size:12345]]".match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});

	test("does not match malformed links", () => {
		// Missing timestamp
		expect("[[123#video:/path/video.mp4]]".match(VIDEO_LINK_REGEX)).toBeNull();
		// Invalid timestamp format
		expect("[[123#video:/path/video.mp4#1:2:3]]".match(VIDEO_LINK_REGEX)).toBeNull();
		// Missing closing brackets
		expect("[[123#video:/path/video.mp4#01:23:45".match(VIDEO_LINK_REGEX)).toBeNull();
		// Not a video link
		expect("[[123#audio:/path/audio.mp3#01:23:45]]".match(VIDEO_LINK_REGEX)).toBeNull();
	});

	test("extracts multiple links from markdown", () => {
		const markdown = `
Some text here
\`\`\` mpv_link
[[123#video:/path/video1.mp4#00:00:00]]
\`\`\`
More text
\`\`\` mpv_link
[[456#video:/path/video2.mp4#01:00:00#hash:abc123]]
[[789#video:/path/video3.mp4#02:00:00##hash:def456#size:9999]]
\`\`\`
`;
		const matches = markdown.match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(3);
	});

	test("matches links without ID prefix", () => {
		const matches = "[[#video:/path/video.mp4#01:23:45]]".match(VIDEO_LINK_REGEX);
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(1);
	});
});
