# Yankit Downloader

Download videos and audio from YouTube, Twitter, TikTok, Instagram and 1000+ sites.

A fast, clean desktop app for Windows and Linux. No ads, no tracking.

## Install

### Windows

1. Download the latest release from [Releases](https://github.com/TridentSky/yankit/releases)
2. Run the installer
3. Done

### From Source

You need [Node.js](https://nodejs.org) (v18+) and [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```
pip install yt-dlp
```

You also need [FFmpeg](https://ffmpeg.org). On Windows, place `ffmpeg.exe` and `ffprobe.exe` in the `bin/` folder. On Linux, install it from your package manager (`apt install ffmpeg`).

Then:

```
cd Yankit
npm install
```

**Windows** — double-click `Yankit.vbs` to launch (no console window).

**Linux** — run `./run.sh`. On desktop environments it opens as a native app. On headless systems it starts a web server at `http://localhost:3000`.

## What it does

- Downloads from 1000+ sites via [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- Pick quality: Best, 4K, 1080p, 720p, or Audio Only (MP3)
- Multiple downloads at once with progress, speed, and time remaining
- Choose where files go
- Dark and Light theme
- Checks for updates automatically (you can ignore them)
- Cleans up partial files if you cancel or close mid-download

## Linux

On desktop Linux (GNOME, KDE, etc.), the app runs as a native Electron window — same experience as Windows.

On servers or headless environments, `run.sh` detects there's no display and starts a web server instead. Open `http://localhost:3000` in your browser to use it. You can also start the server manually:

```
node server.js
```

Set a custom port with `PORT=8080 node server.js`.

## Project Structure

```
Yankit/
├── static/          UI files (HTML, CSS, JS, logo)
├── main.js          Electron main process
├── preload.js       Secure IPC bridge
├── downloader.js    Download engine (shared by desktop and web)
├── server.js        Web server for Linux/headless
├── run.sh           Linux launcher
├── Yankit.vbs       Windows launcher (no console)
├── start.bat        Windows dev launcher
└── package.json
```

## Built With

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — download engine. Licensed under [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE)
- [FFmpeg](https://ffmpeg.org) — media processing. Licensed under [LGPL/GPL](https://ffmpeg.org/legal.html)
- [Electron](https://www.electronjs.org) — desktop framework
- [Claude Code](https://claude.ai/claude-code) — development tool

## Credits

Built by [Brando Silva](https://github.com/TridentSky).

This project wouldn't exist without [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org) — massive thanks to those teams. Development was assisted by [Claude Code](https://claude.ai/claude-code).

## License

MIT License — see [LICENSE](LICENSE) for details.

yt-dlp and FFmpeg are independent projects with their own licenses.
