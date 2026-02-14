# Architecture

## Link Format

Video links are stored inside fenced code blocks in Obsidian markdown:

```
``` mpv_link
[[1234567890#video:relative/path/to/video.mp4#01:23:45]]
```
```

The fields inside `[[...]]` are `#`-separated:

| Field | Example | Description |
|---|---|---|
| id | `1234567890` | `Date.now()` at creation time; unique per link |
| path | `relative/path/to/video.mp4` | Vault-relative path |
| timestamp | `01:23:45` | Last playback position (HH:MM:SS) |
| fixed flag | `#` (trailing) | Optional; if present the timestamp is never auto-updated |
| hash | `#hash:d41d8cd9...` | Optional MD5 of first 10 MB of file |
| size | `#size:104857600` | Optional file size in bytes |

Full example with all fields:

```
[[1234567890#video:videos/lecture.mp4#01:23:45##hash:d41d8cd98f00b204e9800998ecf8427e#size:104857600]]
```

The extra `#` between the timestamp and `#hash:` is the fixed flag. A standard
updatable link with metadata looks like:

```
[[1234567890#video:videos/lecture.mp4#01:23:45#hash:d41d8cd98f00b204e9800998ecf8427e#size:104857600]]
```

---

## Hash-Based File Relocalization

When a video file is moved or renamed, the vault-relative path stored in the
link becomes stale. The relocalization feature finds the new location by
content rather than path.

### Why MD5, and why only the first 10 MB

Video files are large — a single 4K movie can be 50 GB. Hashing the entire
file to identify it would take tens of seconds per file and freeze the UI.

Instead, `calculatePartialMD5` reads only the first **10 MB** (`HASH_CHUNK_SIZE
= 10 * 1024 * 1024`) of each file and computes an MD5 digest over that slice.
For video files this is an acceptable trade-off:

- **Speed:** a 10 MB read from a local disk takes < 50 ms regardless of total
  file size.
- **Uniqueness:** the first 10 MB of a video contains the container header and
  the opening frames. Two different recordings never share identical leading
  bytes in practice.
- **Collision risk:** technically possible but negligible for a personal video
  library. MD5 is used here for speed, not cryptographic security.

If the file is smaller than 10 MB the entire file is read.

### Tiered matching strategy

Scanning a large folder and hashing every file upfront would be slow.
`relocalizeFiles` uses a three-tier strategy, running the cheapest check first
and only escalating when necessary:

```
Tier 1 — Filename match      (O(1) map lookup, no I/O)
Tier 2 — File size match     (one stat() call per candidate)
Tier 3 — Partial MD5 match   (10 MB read per candidate)
```

A dead link only reaches Tier 3 if there are multiple files with the same name
and the same size — an unusual situation. In the common case (file was moved
without renaming) the match resolves at Tier 1 or Tier 2 with no hashing at
all.

Files that cannot be matched by filename at all go into a separate fallback
bucket. If any such links exist, the plugin builds a full hash map of every
video file in the search folder (Phase 3) and does a direct hash lookup.

### Async I/O

All filesystem calls in `hash.ts` use `fs.promises` (async I/O). Obsidian runs
on Electron; its UI thread is the same as Node's main thread. Blocking calls
(`statSync`, `openSync`, `readSync`) would freeze the interface for the entire
duration of a scan. With async I/O the event loop continues to process UI
events between reads, and the `yieldToUI()` calls in `relocalizeFiles`
(`await new Promise(resolve => setTimeout(resolve, 0))`) effectively yield
between each file, keeping the progress modal responsive.

### Where the hash is stored

The hash and file size are embedded in the link string when a link is created
(only when the **Hash relocalization** setting is enabled):

```
formatFilepathToVideoLink(filePath, vaultBasePath, includeHash = true)
  → computes calculatePartialMD5(filePath)   // 10 MB read
  → computes fs.promises.stat(filePath).size
  → appends #hash:<hex>#size:<bytes> to the link
```

On relocalization, `extractDetails` parses those fields back out and passes
them to `relocalizeFiles` as `DeadLinkInfo.hash` and `DeadLinkInfo.size`.

---

## Supported Video Formats

The scanner recognises these extensions (defined in `src/constants.ts`):

`.mp4` `.mkv` `.avi` `.mov` `.webm` `.flv` `.wmv` `.m4v`
