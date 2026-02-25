# mpv Links Plugin for Obsidian

This plugin adds buttons linking to local video files. Clicking a button opens the specified video at a saved timestamp.

## How to install

1. You need to have already installed mpv. Check https://mpv.io/installation/
2. Unzip the most recent release into your <vault>/.obsidian/plugins/ folder.

## How to use this plugin?

1. Open the command palette (type `CMD + P` on Mac or its equivalent on other platforms).
2. Start typing the name of one of the actions. See below:

| Action                    | Hotkey          |
|---------------------------|-----------------|
| Add mpv link              | None by default |
| Go to next MPV link       | None by default |
| Go to previous MPV link   | None by default |
| Open selected MPV link    | None by default |
| Clean dead mpv links      | None by default |
| Update/relocalize links   | None by default |

## Link format

Links are stored inside fenced code blocks with the `mpv_link` tag:

````
``` mpv_link
[[id#video:path#HH:MM:SS]]
```
````

### Fields

| Field       | Description |
|-------------|-------------|
| `id`        | A unique numeric identifier (Unix timestamp in milliseconds). Generated automatically — you never need to set this manually. |
| `video:`    | Literal keyword that marks this as a video link. |
| `path`      | Path to the video file. Can be relative to the vault root or absolute. See [Paths](#paths) below. |
| `HH:MM:SS`  | Playback position in hours:minutes:seconds. Updated automatically each time you close the video. |

### Examples

Standard link (timestamp updates on close):
```
[[1700000000000#video:/home/user/videos/lecture.mp4#00:05:30]]
```

Fixed timestamp (marked with a trailing `#`, never updated):
```
[[1700000000000#video:/home/user/videos/lecture.mp4#00:05:30#]]
```

Link with hash and size for relocalization:
```
[[1700000000000#video:../videos/lecture.mp4#00:05:30#hash:a1b2c3d4#size:1048576]]
```

## Paths

Paths are stored **relative to the vault root**. This makes notes portable: if you move your vault, links continue to work as long as the relative layout between the vault and your videos is preserved.

When you add a link via the command palette, the path is stored automatically. For files inside the vault it looks like:

```
videos/lecture.mp4
```

For files outside the vault, standard `..` notation is used:

```
../videos/podcastOne/videoOne.mp4
```

Absolute paths are also supported and stored as-is:

```
/home/user/videos/lecture.mp4
```

## Settings

| Setting | Description |
|---------|-------------|
| **Remember last folder** | When adding a new link, open the file picker starting from the last folder you used instead of the vault root. |
| **Relocalize files based on their hash** *(Experimental)* | Store an MD5 hash and file size when creating links. Enables the *Update/relocalize links* command to find files that have been moved. |
| **End-of-video buffer (seconds)** | When saving the timestamp after closing a video, cap it this many seconds before the end. Prevents links that instantly reopen and close when the video has ended. Default: 5. |

## Video demonstration

https://github.com/patsh90/mpv-obsidian-plugin/assets/96721578/09bb5840-f4f0-44c3-8f73-c699ef1a952b

## Development

### Local Build

To build and package the plugin locally:

```bash
bun run build-local
```

This will create a zip file named `release_TIMESTAMP.zip` containing the necessary files for the plugin.

## Credits

Many thanks to
Yomaru Hananoshika for publishing ready made skeleton for developing
plugins https://github.com/TopTierTools/obsidian-sample-plugin
