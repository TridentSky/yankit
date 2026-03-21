#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &>/dev/null; then
    echo "Node.js is required. Download it from https://nodejs.org"
    exit 1
fi

if ! command -v yt-dlp &>/dev/null; then
    echo "yt-dlp not found. Installing..."
    pip3 install yt-dlp 2>/dev/null || pip install yt-dlp 2>/dev/null
    if ! command -v yt-dlp &>/dev/null; then
        echo "Failed to install yt-dlp. Install manually: pip install yt-dlp"
        exit 1
    fi
fi

if ! command -v ffmpeg &>/dev/null; then
    echo "ffmpeg not found. Installing..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y ffmpeg
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y ffmpeg
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm ffmpeg
    elif command -v brew &>/dev/null; then
        brew install ffmpeg
    else
        echo "Please install ffmpeg manually for your distribution."
        exit 1
    fi
fi

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
    echo "Starting Yankit Downloader..."
    npx electron .
else
    echo "No display detected. Starting web server..."
    node server.js
fi
