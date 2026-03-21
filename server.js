const http = require('http');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Downloader = require('./downloader');

const PORT = process.env.PORT || 3000;
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const sseClients = new Set();

function broadcast(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
        try { res.write(msg); } catch { sseClients.delete(res); }
    }
}

const dl = new Downloader({
    onUpdate: (data) => broadcast(data),
});

if (!dl.init()) {
    console.error('yt-dlp not found. Install it with: pip install yt-dlp');
    process.exit(1);
}

function readBody(req) {
    return new Promise(resolve => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { resolve({}); }
        });
    });
}

function json(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function checkForUpdate() {
    return new Promise(resolve => {
        https.get({
            hostname: 'api.github.com',
            path: '/repos/TridentSky/yankit/releases/latest',
            headers: { 'User-Agent': 'Yankit' },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) { resolve(null); return; }
                    const r = JSON.parse(data);
                    const latest = (r.tag_name || '').replace(/^v/, '');
                    const lp = latest.split('.').map(Number);
                    const cp = PKG.version.split('.').map(Number);
                    let newer = false;
                    for (let i = 0; i < 3; i++) {
                        if ((lp[i] || 0) > (cp[i] || 0)) { newer = true; break; }
                        if ((lp[i] || 0) < (cp[i] || 0)) break;
                    }
                    resolve(newer ? { version: latest, url: r.html_url } : null);
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write('\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        const body = req.method === 'POST' ? await readBody(req) : {};

        switch (url.pathname) {
            case '/api/fetch-info':
                json(res, await dl.fetchInfo(body.url));
                return;
            case '/api/start-download':
                json(res, { downloadId: dl.startDownload(body) });
                return;
            case '/api/cancel-download':
                dl.cancelDownload(body.id);
                json(res, { ok: true });
                return;
            case '/api/remove-download':
                dl.removeDownload(body.id);
                json(res, { ok: true });
                return;
            case '/api/status':
                json(res, dl.getAllStatus());
                return;
            case '/api/settings':
                json(res, dl.loadSettings());
                return;
            case '/api/save-setting':
                const s = dl.loadSettings();
                s[body.key] = body.value;
                dl.saveSettings(s);
                json(res, { ok: true });
                return;
            case '/api/check-update':
                json(res, await checkForUpdate());
                return;
            case '/api/version':
                json(res, PKG.version);
                return;
            default:
                json(res, { error: 'Not found' }, 404);
                return;
        }
    }

    let filePath = url.pathname === '/'
        ? path.join(__dirname, 'static', 'index.html')
        : path.join(__dirname, 'static', url.pathname);

    filePath = path.resolve(filePath);
    if (!filePath.startsWith(path.join(__dirname, 'static'))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        const data = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`\n  Yankit Downloader v${PKG.version}`);
    console.log(`  Running at http://localhost:${PORT}\n`);
});

process.on('SIGINT', () => {
    dl.cleanupAll();
    process.exit();
});

process.on('SIGTERM', () => {
    dl.cleanupAll();
    process.exit();
});
