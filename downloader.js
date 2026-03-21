const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';

class Downloader {
    constructor(opts = {}) {
        this.binDir = opts.binDir || path.join(__dirname, 'bin');
        this.settingsPath = opts.settingsPath || path.join(__dirname, 'settings.json');
        this.onUpdate = opts.onUpdate || (() => {});
        this.ytDlpCmd = null;
        this.ytDlpBaseArgs = [];
        this.processes = new Map();
        this.downloads = new Map();
    }

    init() {
        return this._findYtDlp();
    }

    _findYtDlp() {
        const ext = IS_WIN ? '.exe' : '';
        const local = path.join(this.binDir, 'yt-dlp' + ext);
        if (fs.existsSync(local)) {
            this.ytDlpCmd = local;
            // Verify it's actually executable
            try {
                execSync(`"${local}" --version`, { windowsHide: true, stdio: 'pipe', timeout: 15000 });
            } catch {
                // File exists but can't run — might be blocked by antivirus, still try
            }
            return true;
        }
        try {
            execSync('yt-dlp --version', { windowsHide: true, stdio: 'pipe', timeout: 10000 });
            this.ytDlpCmd = 'yt-dlp';
            return true;
        } catch {}
        const py = IS_WIN ? 'python' : 'python3';
        try {
            execSync(`${py} -m yt_dlp --version`, { windowsHide: true, stdio: 'pipe', timeout: 10000 });
            this.ytDlpCmd = py;
            this.ytDlpBaseArgs = ['-m', 'yt_dlp'];
            return true;
        } catch {}
        return false;
    }

    _ffmpegArgs() {
        const ext = IS_WIN ? '.exe' : '';
        if (fs.existsSync(path.join(this.binDir, 'ffmpeg' + ext))) {
            return ['--ffmpeg-location', this.binDir];
        }
        return [];
    }

    loadSettings() {
        try {
            return JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
        } catch {
            return { downloadPath: path.join(os.homedir(), 'Downloads'), theme: 'dark' };
        }
    }

    saveSettings(s) {
        fs.writeFileSync(this.settingsPath, JSON.stringify(s, null, 2));
    }

    fetchInfo(url) {
        return new Promise(resolve => {
            const args = [
                ...this.ytDlpBaseArgs, ...this._ffmpegArgs(),
                '--dump-json', '--no-playlist', url,
            ];
            const proc = spawn(this.ytDlpCmd, args, { windowsHide: true });
            let stdout = '', stderr = '';
            proc.stdout.on('data', d => stdout += d);
            proc.stderr.on('data', d => stderr += d);

            const timeout = setTimeout(() => {
                proc.kill();
                resolve({ error: 'Request timed out.' });
            }, 45000);

            proc.on('close', code => {
                clearTimeout(timeout);
                if (code !== 0) {
                    const lines = stderr.trim().split('\n');
                    resolve({ error: lines[lines.length - 1] || 'Failed to fetch info' });
                    return;
                }
                try {
                    const info = JSON.parse(stdout);
                    const heights = new Set();
                    for (const f of (info.formats || [])) {
                        if (f.height && f.vcodec && f.vcodec !== 'none') heights.add(f.height);
                    }
                    const qualities = [{ id: 'best', label: 'Best Quality (MP4)' }];
                    for (const h of [...heights].sort((a, b) => b - a)) {
                        let label = `${h}p`;
                        if (h >= 2160) label = `4K (${h}p)`;
                        else if (h >= 1440) label = `2K (${h}p)`;
                        qualities.push({ id: `res_${h}`, label });
                    }
                    qualities.push({ id: 'audio', label: 'Audio Only (MP3)' });
                    resolve({
                        title: info.title || 'Unknown',
                        thumbnail: info.thumbnail || '',
                        duration: info.duration || 0,
                        uploader: info.uploader || '',
                        qualities, url,
                    });
                } catch {
                    resolve({ error: 'Failed to parse video info' });
                }
            });

            proc.on('error', () => {
                clearTimeout(timeout);
                resolve({ error: 'Failed to run yt-dlp' });
            });
        });
    }

    startDownload({ url, qualityId, title, thumbnail }) {
        const id = crypto.randomUUID().slice(0, 8);
        const settings = this.loadSettings();
        const outDir = settings.downloadPath || path.join(os.homedir(), 'Downloads');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const args = [
            ...this.ytDlpBaseArgs, ...this._ffmpegArgs(),
            '--newline', '--no-playlist',
            '-o', path.join(outDir, '%(title)s.%(ext)s'),
        ];

        if (qualityId === 'best') {
            args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
            args.push('--merge-output-format', 'mp4');
        } else if (qualityId === 'audio') {
            args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else if (qualityId.startsWith('res_')) {
            const h = qualityId.split('_')[1];
            args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`);
            args.push('--merge-output-format', 'mp4');
        } else {
            args.push('-f', 'best');
        }
        args.push(url);

        const dl = {
            id, title: title || 'Unknown', thumbnail: thumbnail || '',
            status: 'starting', progress: 0, speed: '', eta: 0,
            filename: '', filepath: '', error: '',
            quality: qualityId, trackedFiles: [],
        };
        this.downloads.set(id, dl);
        this.onUpdate(dl);

        const proc = spawn(this.ytDlpCmd, args, { windowsHide: true });
        this.processes.set(id, proc);

        let buf = '';
        proc.stdout.on('data', data => {
            buf += data.toString();
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                if (line.trim()) this._parseLine(line.trim(), dl);
            }
            this.onUpdate(dl);
        });

        proc.stderr.on('data', data => {
            const line = data.toString().trim();
            if (line && dl.status !== 'cancelled') dl.error = line.split('\n').pop();
        });

        proc.on('close', code => {
            this.processes.delete(id);
            if (dl.status !== 'cancelled') {
                if (code === 0) {
                    dl.status = 'completed';
                    dl.progress = 100;
                    dl.eta = 0;
                } else {
                    dl.status = 'error';
                    if (!dl.error) dl.error = 'Download failed';
                    this._cleanup(dl);
                }
            }
            this.onUpdate(dl);
        });

        proc.on('error', err => {
            this.processes.delete(id);
            dl.status = 'error';
            dl.error = err.message;
            this.onUpdate(dl);
        });

        return id;
    }

    cancelDownload(id) {
        const proc = this.processes.get(id);
        const dl = this.downloads.get(id);
        if (proc) { try { proc.kill(); } catch {} this.processes.delete(id); }
        if (dl) { dl.status = 'cancelled'; this._cleanup(dl); this.onUpdate(dl); }
    }

    removeDownload(id) {
        const proc = this.processes.get(id);
        if (proc) { try { proc.kill(); } catch {} this.processes.delete(id); }
        this.downloads.delete(id);
    }

    getAllStatus() {
        return Array.from(this.downloads.values());
    }

    hasActive() {
        return this.getAllStatus().some(
            d => ['starting', 'downloading', 'merging', 'converting'].includes(d.status)
        );
    }

    cleanupAll() {
        for (const [id, proc] of this.processes) {
            try { proc.kill(); } catch {}
            const dl = this.downloads.get(id);
            if (dl && dl.status !== 'completed') this._cleanup(dl);
        }
        this.processes.clear();
    }

    _parseLine(line, dl) {
        if (line.includes('[download]') && line.includes('%')) {
            dl.status = 'downloading';
            const pm = line.match(/([\d.]+)%/);
            if (pm) dl.progress = parseFloat(pm[1]);
            const sm = line.match(/at\s+([\d.]+\S+)/);
            if (sm) dl.speed = sm[1];
            const em = line.match(/ETA\s+(\S+)/);
            if (em && em[1] !== 'Unknown') {
                const raw = this._etaToSec(em[1]);
                if (raw > 0) {
                    if (!dl._smooth || dl.progress < (dl._prevProg || 0)) {
                        dl._smooth = raw;
                    } else {
                        dl._smooth = Math.round(dl._smooth * 0.7 + raw * 0.3);
                    }
                    dl._prevProg = dl.progress;
                    dl.eta = dl._smooth;
                }
            } else if (!em) {
                dl.eta = 0;
            }
        } else if (line.includes('[download] Destination:')) {
            const fp = line.split('Destination:')[1].trim();
            dl.filepath = fp;
            dl.filename = path.basename(fp);
            if (!dl.trackedFiles.includes(fp)) dl.trackedFiles.push(fp);
        } else if (line.includes('[Merger]')) {
            dl.status = 'merging';
            dl.progress = 100;
            dl.eta = 0;
            const m = line.match(/"([^"]+)"/);
            if (m) {
                dl.filepath = m[1];
                dl.filename = path.basename(m[1]);
                if (!dl.trackedFiles.includes(m[1])) dl.trackedFiles.push(m[1]);
            }
        } else if (line.includes('[ExtractAudio]')) {
            dl.status = 'converting';
            dl.progress = 100;
            dl.eta = 0;
            const m = line.match(/Destination:\s*(.+)/);
            if (m) {
                dl.filepath = m[1].trim();
                dl.filename = path.basename(dl.filepath);
                if (!dl.trackedFiles.includes(dl.filepath)) dl.trackedFiles.push(dl.filepath);
            }
        } else if (line.includes('has already been downloaded')) {
            dl.status = 'completed';
            dl.progress = 100;
            dl.eta = 0;
        }
    }

    _etaToSec(s) {
        if (!s || s === 'Unknown') return 0;
        const p = s.split(':').map(Number);
        if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
        if (p.length === 2) return p[0] * 60 + p[1];
        return p[0] || 0;
    }

    _cleanup(dl) {
        if (!dl) return;
        const files = [...(dl.trackedFiles || [])];
        if (dl.filepath && !files.includes(dl.filepath)) files.push(dl.filepath);
        for (const fp of files) {
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
            try { if (fs.existsSync(fp + '.part')) fs.unlinkSync(fp + '.part'); } catch {}
        }
    }
}

module.exports = Downloader;
