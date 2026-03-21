# Yankit Downloader

Download videos and audio from YouTube, Twitter, TikTok, Instagram and 1000+ sites.

A fast, clean desktop app for Windows and Linux. No ads, no tracking, no accounts.

## Install

### Windows

1. Download **Yankit-Setup.exe** from [Releases](https://github.com/TridentSky/yankit/releases)
2. Run the installer — choose your install folder (Program Files or anywhere)
3. Desktop and Start Menu shortcuts are created automatically
4. Everything is bundled (yt-dlp, ffmpeg), no extra setup

### From Source

Requires [Node.js](https://nodejs.org) v18+ and [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```
pip install yt-dlp
```

[FFmpeg](https://ffmpeg.org) is also needed. On Windows, place `ffmpeg.exe` and `ffprobe.exe` in the `bin/` folder. On Linux, install from your package manager (`apt install ffmpeg`).

```
cd Yankit
npm install
```

**Windows** — double-click `Yankit.vbs` to launch (no console window).

**Linux** — run `./run.sh`. On desktop environments it opens as a native app. On headless systems it starts a web server at `http://localhost:3000`.

## Features

- Downloads from 1000+ sites via [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- Pick quality: Best, 4K, 1080p, 720p, or Audio Only (MP3)
- Multiple downloads at once with progress, speed, and ETA
- Choose download folder
- Dark and Light theme
- Auto-update notifications
- Cleans up partial files on cancel

## Linux

On desktop Linux (GNOME, KDE, etc.), the app runs as a native Electron window.

On servers or headless environments, `run.sh` starts a web server instead. Open `http://localhost:3000` in your browser. You can also start the server manually:

```
node server.js
```

Custom port: `PORT=8080 node server.js`.

## Built With

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — download engine ([Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE))
- [FFmpeg](https://ffmpeg.org) — media processing ([LGPL/GPL](https://ffmpeg.org/legal.html))
- [Electron](https://www.electronjs.org) — desktop framework
- Developed with [Claude Code](https://claude.ai/claude-code)

## License

MIT License — see [LICENSE](LICENSE) for details.

yt-dlp and FFmpeg are independent projects with their own licenses.
