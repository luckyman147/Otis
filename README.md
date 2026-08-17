# Otis

Otis records the audio of the current YouTube video and saves it as an MP3 file.
Everything runs locally in your browser - no microphone, no servers, no accounts.

## Features

- Record the audio of any YouTube video with one click (manual start/stop)
- MP3 encoded in-browser at 128 / 192 / 320 kbps (lamejs)
- ID3 tags with the video title and channel name
- Audio stays audible while recording (digital capture, not the microphone)
- File saved to your Downloads folder with a descriptive name

## Install

1. Open `about:debugging` in Firefox
2. Click **This Firefox** → **Load Temporary Add-on…**
3. Select `otis-0.2.1.xpi` (from `web-ext-artifacts/`, or build your own)

> Unsigned XPIs cannot be permanently installed on release Firefox.
> For permanent install, either use Firefox Developer Edition with
> `xpinstall.signatures.required = false`, or submit the add-on to
> addons.mozilla.org for signing.

## Usage

1. Open any video on YouTube
2. Click **Record** in the Otis panel (top-right of the page)
3. Click **Stop & Save** when done - the MP3 lands in your Downloads folder

## Build

```
web-ext lint
web-ext build
```

## Limitations

- DRM-protected videos (some premium/4K content) record silence on Firefox
- Ads and pauses are recorded exactly as heard
- Navigating away from the tab stops the recording

## License

MIT