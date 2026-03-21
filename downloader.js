const { spawn, spawnSync } = require('child_process');
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
            try {
                spawnSync(local, ['--version'], { windowsHide: true, stdio: 'pipe', timeout: 15000 });
            } catch {}
            return true;
        }
        try {
            const r = spawnSync('yt-dlp', ['--version'], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
            if (r.status === 0) { this.ytDlpCmd = 'yt-dlp'; return true; }
        } catch {}
        const py = IS_WIN ? 'python' : 'python3';
        try {
            const r = spawnSync(py, ['-m', 'yt_dlp', '--version'], { windowsHide: true, stdio: 'pipe', timeout: 10000 });
            if (r.status === 0) { this.ytDlpCmd = py; this.ytDlpBaseArgs = ['-m', 'yt_dlp']; return true; }
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

    checkExists(title) {
        const settings = this.loadSettings();
        let outDir = settings.downloadPath || path.join(os.homedir(), 'Downloads');
        if (!path.isAbsolute(outDir)) outDir = path.join(os.homedir(), 'Downloads');
        if (!title || !fs.existsSync(outDir)) return null;
        try {
            for (const f of fs.readdirSync(outDir)) {
                const name = path.basename(f, path.extname(f));
                if (name === title) return f;
            }
        } catch {}
        return null;
    }

    startDownload({ url, qualityId, title, thumbnail, replace }) {
        try {
            const u = new URL(url);
            if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
        } catch { return null; }

        if (!replace && title) {
            const existing = this.checkExists(title);
            if (existing) return { exists: true, filename: existing };
        }

        const id = crypto.randomUUID().slice(0, 8);
        const settings = this.loadSettings();
        let outDir = settings.downloadPath || path.join(os.homedir(), 'Downloads');
        if (!path.isAbsolute(outDir)) outDir = path.join(os.homedir(), 'Downloads');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const args = [
            ...this.ytDlpBaseArgs, ...this._ffmpegArgs(),
            '--newline', '--no-playlist',
            '-o', path.join(outDir, '%(title)s.%(ext)s'),
        ];

        if (replace) args.push('--force-overwrites');

        if (qualityId === 'best') {
            args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
            args.push('--merge-output-format', 'mp4');
        } else if (qualityId === 'audio') {
            args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else if (qualityId.startsWith('res_')) {
            const h = parseInt(qualityId.split('_')[1], 10);
            if (isNaN(h) || h < 1 || h > 8192) { args.push('-f', 'best'); }
            else { args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`); }
            args.push('--merge-output-format', 'mp4');
        } else {
            args.push('-f', 'best');
        }
        args.push(url);

        const dl = {
            id, title: title || 'Unknown', thumbnail: thumbnail || '',
            status: 'starting', progress: 0, speed: '', eta: 0,
            filename: '', filepath: '', error: '',
            quality: qualityId, trackedFiles: [], outDir,
        };
        this.downloads.set(id, dl);
        this.onUpdate(dl);

        const proc = spawn(this.ytDlpCmd, args, { windowsHide: true });
        this.processes.set(id, proc);

        let buf = '';
        proc.stdout.on('data', data => {
            buf += data.toString();
            if (buf.length > 20000) buf = buf.slice(-10000);
            const lines = buf.split('\n');
            buf = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed.includes('Destination:') || trimmed.includes('[Merger]') || trimmed.includes('[ExtractAudio]')) {
                    this._parseFileLine(trimmed, dl);
                }
                if (dl.status === 'cancelled') continue;
                this._parseLine(trimmed, dl);
            }
            if (dl.status !== 'cancelled') this.onUpdate(dl);
        });

        proc.stderr.on('data', data => {
            if (dl.status === 'cancelled') return;
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed.startsWith('WARNING:')) continue;
                dl.error = trimmed;
            }
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
                    if (!dl.error) dl.error = `Download failed (exit code ${code})`;
                    this._cleanup(dl);
                }
            }
            this.onUpdate(dl);
        });

        proc.on('error', err => {
            this.processes.delete(id);
            if (dl.status === 'cancelled') return;
            dl.status = 'error';
            dl.error = err.message;
            this.onUpdate(dl);
        });

        return id;
    }

    _killProc(proc) {
        try {
            if (IS_WIN) {
                spawn('taskkill', ['/pid', proc.pid.toString(), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            } else {
                proc.kill('SIGKILL');
            }
        } catch {}
    }

    cancelDownload(id) {
        const dl = this.downloads.get(id);
        if (dl) dl.status = 'cancelled';
        const proc = this.processes.get(id);
        if (proc) { this._killProc(proc); this.processes.delete(id); }
        if (dl) { this._cleanup(dl); this.onUpdate(dl); }
    }

    removeDownload(id) {
        const proc = this.processes.get(id);
        if (proc) { this._killProc(proc); this.processes.delete(id); }
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
            this._killProc(proc);
            const dl = this.downloads.get(id);
            if (dl && dl.status !== 'completed') this._cleanup(dl);
        }
        this.processes.clear();
    }

    _trackFile(fp, dl) {
        if (fp && !dl.trackedFiles.includes(fp)) dl.trackedFiles.push(fp);
        dl.filepath = fp;
        dl.filename = path.basename(fp);
    }

    _parseFileLine(line, dl) {
        if (line.includes('[download] Destination:')) {
            this._trackFile(line.split('Destination:')[1].trim(), dl);
        } else if (line.includes('[Merger]')) {
            const m = line.match(/"([^"]+)"/);
            if (m) this._trackFile(m[1], dl);
        } else if (line.includes('[ExtractAudio]')) {
            const m = line.match(/Destination:\s*(.+)/);
            if (m) this._trackFile(m[1].trim(), dl);
        }
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
                        dl._smooth = Math.round(dl._smooth * 0.85 + raw * 0.15);
                    }
                    dl._prevProg = dl.progress;
                    dl.eta = dl._smooth;
                    dl._lastEtaTime = Date.now();
                }
            } else {
                if (dl._lastEtaTime && Date.now() - dl._lastEtaTime > 3000) {
                    dl.eta = 0;
                }
            }
        } else if (line.includes('[Merger]')) {
            dl.status = 'merging';
            dl.progress = 100;
            dl.eta = 0;
        } else if (line.includes('[ExtractAudio]')) {
            dl.status = 'converting';
            dl.progress = 100;
            dl.eta = 0;
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
        const doClean = () => {
            const files = [...(dl.trackedFiles || [])];
            if (dl.filepath && !files.includes(dl.filepath)) files.push(dl.filepath);

            const dirsScanned = new Set();
            for (const fp of files) {
                for (const f of [fp, fp + '.part', fp + '.ytdl']) {
                    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
                }
                const dir = path.dirname(fp);
                if (!dirsScanned.has(dir)) {
                    dirsScanned.add(dir);
                    const base = path.basename(fp, path.extname(fp));
                    this._cleanDir(dir, base);
                }
            }

            if (dl.outDir && dl.title && dl.title !== 'Unknown' && !dirsScanned.has(dl.outDir)) {
                this._cleanDir(dl.outDir, dl.title);
            }
        };
        doClean();
        setTimeout(doClean, 2000);
        setTimeout(doClean, 5000);
    }

    _cleanDir(dir, prefix) {
        try {
            for (const f of fs.readdirSync(dir)) {
                if (f.startsWith(prefix) && (f.endsWith('.part') || f.endsWith('.ytdl') || f.includes('.part-Frag'))) {
                    try { fs.unlinkSync(path.join(dir, f)); } catch {}
                }
            }
        } catch {}
    }
}

module.exports = Downloader;
