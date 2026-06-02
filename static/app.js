function createWebApi() {
    const listeners = [];
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        listeners.forEach(cb => cb(data));
    };
    function post(endpoint, body) {
        return fetch('/api/' + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(r => r.json());
    }
    return {
        fetchInfo: (url) => post('fetch-info', { url }),
        startDownload: (data) => post('start-download', data),
        cancelDownload: (id) => post('cancel-download', { id }),
        removeDownload: (id) => post('remove-download', { id }),
        getAllStatus: () => fetch('/api/status').then(r => r.json()),
        getSettings: () => fetch('/api/settings').then(r => r.json()),
        saveSetting: (k, v) => post('save-setting', { key: k, value: v }),
        pickFolder: () => {
            const p = prompt('Enter download path:');
            if (p) return post('save-setting', { key: 'downloadPath', value: p }).then(() => p);
            return Promise.resolve(null);
        },
        openFile: () => {},
        showInFolder: () => {},
        openFolder: () => {},
        openUrl: (url) => { window.open(url, '_blank'); },
        onDownloadUpdate: (cb) => listeners.push(cb),
        checkUpdate: () => fetch('/api/check-update').then(r => r.json()).catch(() => null),
        getVersion: () => fetch('/api/version').then(r => r.json()).catch(() => '1.0.0'),
    };
}

const yankitApi = window.api || createWebApi();

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const urlInput = $('#urlInput');
const pasteBtn = $('#pasteBtn');
const clearBtn = $('#clearBtn');
const fetchBtn = $('#fetchBtn');
const fetchLoading = $('#fetchLoading');
const fetchError = $('#fetchError');
const videoPreview = $('#videoPreview');
const qualitySelect = $('#qualitySelect');
const downloadBtn = $('#downloadBtn');
const downloadsList = $('#downloadsList');
const emptyState = $('#emptyState');
const settingsOverlay = $('#settingsOverlay');
const downloadPath = $('#downloadPath');
const updateDot = $('#updateDot');
const updateBanner = $('#updateBanner');

let currentInfo = null;
let pendingUpdate = null;
const downloads = new Map();

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

let _toastTimer = null;
function showToast(message) {
    let el = $('#toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

function formatDuration(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatEta(seconds) {
    if (!seconds || seconds <= 0) return '';
    seconds = Math.round(seconds);
    if (seconds >= 3600) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m left`;
    }
    if (seconds >= 60) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s left`;
    }
    return `${seconds}s left`;
}

function qualityLabel(id) {
    if (id === 'best') return 'Best';
    if (id === 'audio') return 'MP3';
    if (id && id.startsWith('res_')) return id.split('_')[1] + 'p';
    return id || '';
}

function metaText(dl) {
    switch (dl.status) {
        case 'starting': return 'Starting...';
        case 'downloading': {
            let t = `${Math.round(dl.progress)}%`;
            if (dl.speed) t += ` \u00B7 ${dl.speed}`;
            return t;
        }
        case 'merging': return 'Merging video + audio...';
        case 'converting': return dl.quality === 'audio' ? 'Converting to MP3...' : 'Converting to H.264...';
        case 'completed': return `Completed \u00B7 ${qualityLabel(dl.quality)}`;
        case 'error': return dl.error || 'Error';
        case 'cancelled': return 'Cancelled';
        default: return dl.status || '';
    }
}

function createCardHtml(dl) {
    const isActive = ['starting', 'downloading', 'merging', 'converting'].includes(dl.status);
    const isDone = dl.status === 'completed';
    const isFailed = dl.status === 'error' || dl.status === 'cancelled';
    const etaStr = isActive ? formatEta(dl.eta) : '';

    let actionsHtml = '';
    if (isActive) {
        actionsHtml = `<button class="dl-action-btn cancel" data-action="cancel" data-id="${dl.id}" title="Cancel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    } else if (isDone) {
        actionsHtml = `<button class="dl-action-btn open" data-action="open" data-id="${dl.id}" title="Open file">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>
            <button class="dl-action-btn" data-action="folder" data-id="${dl.id}" title="Show in folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
            <button class="dl-action-btn cancel" data-action="remove" data-id="${dl.id}" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    } else if (isFailed) {
        actionsHtml = `<button class="dl-action-btn cancel" data-action="remove" data-id="${dl.id}" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
    }

    return `<div class="dl-card ${dl.status}" data-id="${dl.id}" data-status="${dl.status}" data-new>
        <div class="dl-thumb-wrap">
            <img src="${escapeHtml(dl.thumbnail)}" class="dl-thumb">
            ${isDone ? '<div class="dl-check">&#10003;</div>' : ''}
        </div>
        <div class="dl-body">
            <div class="dl-title">${escapeHtml(dl.title)}</div>
            <div class="dl-meta">${escapeHtml(metaText(dl))}</div>
            ${isActive ? `<div class="dl-eta" ${etaStr ? '' : 'style="visibility:hidden"'}>${etaStr || '0s left'}</div>` : ''}
            ${isActive ? `<div class="dl-progress"><div class="dl-progress-fill" style="width:${dl.progress}%"></div></div>` : ''}
        </div>
        <div class="dl-actions">${actionsHtml}</div>
    </div>`;
}

const _updateTimers = new Map();
function updateDownloadUI(dl) {
    downloads.set(dl.id, dl);

    if (dl.status === 'downloading') {
        if (_updateTimers.has(dl.id)) return;
        _updateTimers.set(dl.id, setTimeout(() => {
            _updateTimers.delete(dl.id);
            _renderCard(downloads.get(dl.id));
        }, 250));
        return;
    }
    _renderCard(dl);
}

function _renderCard(dl) {
    if (!dl) return;
    const card = downloadsList.querySelector(`[data-id="${dl.id}"]`);

    if (!card) {
        downloadsList.insertAdjacentHTML('afterbegin', createCardHtml(dl));
        setTimeout(() => {
            const el = downloadsList.querySelector(`[data-id="${dl.id}"]`);
            if (el) el.removeAttribute('data-new');
        }, 300);
        emptyState.classList.add('hidden');
        return;
    }

    const prevStatus = card.dataset.status;
    if (prevStatus !== dl.status) {
        const temp = document.createElement('div');
        temp.innerHTML = createCardHtml(dl);
        const newCard = temp.firstElementChild;
        newCard.removeAttribute('data-new');
        if (dl.status === 'completed' && prevStatus !== 'completed') {
            newCard.setAttribute('data-just-completed', '');
            setTimeout(() => newCard.removeAttribute('data-just-completed'), 700);
        }
        card.replaceWith(newCard);
    } else {
        const meta = card.querySelector('.dl-meta');
        if (meta) meta.textContent = metaText(dl);

        const etaEl = card.querySelector('.dl-eta');
        const etaStr = formatEta(dl.eta);
        if (etaEl) {
            if (etaStr) {
                etaEl.textContent = etaStr;
                etaEl.style.visibility = '';
            } else {
                etaEl.style.visibility = 'hidden';
            }
        }

        const fill = card.querySelector('.dl-progress-fill');
        if (fill) fill.style.width = `${dl.progress}%`;
    }

    emptyState.classList.toggle('hidden', downloads.size > 0);
}

downloadsList.addEventListener('error', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('dl-thumb')) {
        e.target.style.display = 'none';
    }
}, true);

downloadsList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'cancel') yankitApi.cancelDownload(id);
    if (action === 'remove') {
        yankitApi.removeDownload(id);
        downloads.delete(id);
        const card = downloadsList.querySelector(`[data-id="${id}"]`);
        if (card) card.remove();
        emptyState.classList.toggle('hidden', downloads.size > 0);
    }
    if (action === 'open' || action === 'folder') {
        const dl = downloads.get(id);
        if (dl && dl.filepath) {
            const call = action === 'open'
                ? yankitApi.openFile(dl.filepath)
                : yankitApi.showInFolder(dl.filepath);
            Promise.resolve(call).then(res => {
                if (res && res.ok === false) {
                    if (res.reason === 'missing-file') showToast('File was moved or deleted — opened the folder instead');
                    else showToast('Could not open the file');
                }
            }).catch(() => {});
        } else {
            yankitApi.openFolder();
            showToast('Opened the downloads folder');
        }
    }
});

urlInput.addEventListener('input', () => {
    const hasVal = urlInput.value.trim().length > 0;
    clearBtn.classList.toggle('hidden', !hasVal);
    pasteBtn.classList.toggle('hidden', hasVal);
});

pasteBtn.addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            urlInput.value = text;
            urlInput.dispatchEvent(new Event('input'));
            urlInput.focus();
        }
    } catch { urlInput.focus(); }
});

clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    urlInput.dispatchEvent(new Event('input'));
    resetPreview();
    urlInput.focus();
});

urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchBtn.click();
});

function resetPreview() {
    videoPreview.classList.add('hidden');
    fetchError.classList.add('hidden');
    fetchLoading.classList.add('hidden');
    currentInfo = null;
}

fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    resetPreview();
    fetchLoading.classList.remove('hidden');
    fetchBtn.disabled = true;
    const result = await yankitApi.fetchInfo(url);
    fetchLoading.classList.add('hidden');
    fetchBtn.disabled = false;
    if (result.error) {
        fetchError.textContent = result.error;
        fetchError.classList.remove('hidden');
        return;
    }
    currentInfo = result;
    $('#previewThumb').src = result.thumbnail;
    $('#previewTitle').textContent = result.title;
    $('#previewUploader').textContent = result.uploader;
    $('#previewDuration').textContent = formatDuration(result.duration);
    qualitySelect.innerHTML = '';
    for (const q of result.qualities) {
        const opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.label;
        qualitySelect.appendChild(opt);
    }
    videoPreview.classList.remove('hidden');
});

downloadBtn.addEventListener('click', async () => {
    if (!currentInfo) return;
    const data = {
        url: currentInfo.url,
        qualityId: qualitySelect.value,
        title: currentInfo.title,
        thumbnail: currentInfo.thumbnail,
    };
    let result = await yankitApi.startDownload(data);
    if (result && result.exists) {
        if (!confirm(`"${result.filename}" already exists.\nDo you want to replace it?`)) return;
        data.replace = true;
        result = await yankitApi.startDownload(data);
    }
    if (result && result.downloadId) {
        videoPreview.classList.add('hidden');
        urlInput.value = '';
        urlInput.dispatchEvent(new Event('input'));
        currentInfo = null;
    }
});

$('#openFolderBtn').addEventListener('click', () => yankitApi.openFolder());

$('#themeToggle').addEventListener('click', async () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    await yankitApi.saveSetting('theme', next);
});

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $$('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}

$('#settingsToggle').addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', closeSettings);
$('.settings-backdrop').addEventListener('click', closeSettings);

function openSettings() {
    settingsOverlay.classList.remove('hidden');
    requestAnimationFrame(() => settingsOverlay.classList.add('visible'));
}

function closeSettings() {
    settingsOverlay.classList.remove('visible');
    setTimeout(() => settingsOverlay.classList.add('hidden'), 300);
}

$$('.theme-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
        applyTheme(btn.dataset.theme);
        await yankitApi.saveSetting('theme', btn.dataset.theme);
    });
});

$('#changePath').addEventListener('click', async () => {
    const p = await yankitApi.pickFolder();
    if (p) downloadPath.textContent = p;
});

const editorCompatToggle = $('#editorCompatToggle');
function setEditorCompat(on) {
    editorCompatToggle.classList.toggle('on', on);
    editorCompatToggle.setAttribute('aria-checked', on ? 'true' : 'false');
}
editorCompatToggle.addEventListener('click', async () => {
    const next = !editorCompatToggle.classList.contains('on');
    setEditorCompat(next);
    await yankitApi.saveSetting('editorCompat', next);
});

$('#linkGithub').addEventListener('click', () => yankitApi.openUrl('https://github.com/TridentSky/yankit'));
$('#linkDiscord').addEventListener('click', () => yankitApi.openUrl('https://discord.com'));

$('#updateDownload').addEventListener('click', () => {
    if (pendingUpdate) yankitApi.openUrl(pendingUpdate.url);
});

$('#updateDismiss').addEventListener('click', async () => {
    if (pendingUpdate) {
        await yankitApi.saveSetting('dismissedUpdate', pendingUpdate.version);
        updateBanner.classList.add('hidden');
        updateDot.classList.add('hidden');
        pendingUpdate = null;
    }
});

yankitApi.onDownloadUpdate((dl) => updateDownloadUI(dl));

async function init() {
    const settings = await yankitApi.getSettings();
    applyTheme(settings.theme || 'dark');
    downloadPath.textContent = settings.downloadPath;
    setEditorCompat(settings.editorCompat !== false);

    const version = await yankitApi.getVersion();
    $('#footerVersion').textContent = `Yankit Downloader v${version}`;
    $('#aboutVersion').textContent = `Yankit Downloader v${version}`;

    const allStatus = await yankitApi.getAllStatus();
    for (const dl of allStatus) updateDownloadUI(dl);

    urlInput.focus();

    const update = await yankitApi.checkUpdate();
    if (update && update.version !== settings.dismissedUpdate) {
        pendingUpdate = update;
        updateDot.classList.remove('hidden');
        $('#updateText').textContent = `v${update.version} available`;
        updateBanner.classList.remove('hidden');
    }
}

init();
