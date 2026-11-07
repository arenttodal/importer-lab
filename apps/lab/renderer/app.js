'use strict';

// Screens 1–3. Plain DOM code; all data arrives through window.labAPI without absolute paths.

const api = window.labAPI;
const $ = (id) => document.getElementById(id);

const state = { view: null, mode: 'preserve', sort: 'name' };

const TYPE_LABELS = { bounces: ['bounce', 'bounces'], projects: ['project', 'projects'], stems: ['stem', 'stems'], videos: ['video', 'videos'], unknown: ['other file', 'other files'] };

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function countLabel(type, count) {
    const [one, many] = TYPE_LABELS[type];
    return `${count} ${count === 1 ? one : many}`;
}

// "3 bounces · 1 project · 14 stems"
function countsLine(files) {
    const counts = {};
    for (const file of files) counts[file.type] = (counts[file.type] || 0) + 1;
    return ['bounces', 'projects', 'stems', 'videos'].filter((type) => counts[type]).map((type) => countLabel(type, counts[type])).join(' · ');
}

function showScreen(name) {
    for (const button of document.querySelectorAll('nav .std-segment')) button.classList.toggle('is-active', button.dataset.screen === name);
    for (const panel of document.querySelectorAll('[data-screen-panel]')) panel.hidden = panel.dataset.screenPanel !== name;
}

// ── Screen 1 ──

function renderFolders(folders) {
    $('folderList').innerHTML = folders
        .map(
            (folder) => `<div class="std-list-row">
                <span class="std-list-label">${escapeHtml(folder.name)}</span>
                <button class="std-inline-btn std-inline-btn--destructive" type="button" data-remove="${escapeHtml(folder.id)}">Remove</button>
            </div>`
        )
        .join('');
    $('folderEmpty').hidden = folders.length > 0;
    $('startScan').disabled = folders.length === 0;
}

function selectedValue(name) {
    return document.querySelector(`input[name="${name}"]:checked`).value;
}

async function startScan() {
    $('startError').hidden = true;
    try {
        await api.startScan({ mergeRule: selectedValue('mergeRule'), includeCloudPlaceholders: selectedValue('placeholders'), maxCostUsd: $('maxCostUsd').value });
    } catch (error) {
        $('startError').textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
        $('startError').hidden = false;
        return;
    }
    for (const id of ['statFiles', 'statFolders']) $(id).textContent = '0';
    for (const id of ['statProjects', 'statSongs']) $(id).textContent = '—';
    $('scanPhase').textContent = 'Reading folders…';
    $('scanProgress').hidden = false;
    $('cancelScan').disabled = false;
    $('viewCatalog').hidden = true;
    showScreen('scan');
}

// ── Screen 2 ──

const PHASES = {
    crawl: 'Reading folders…',
    placeholders: 'Checking for cloud placeholders (metadata only)…',
    baseline: "Running today's importer on the same files…",
    done: 'Done'
};

function onProgress(progress) {
    $('scanPhase').textContent = PHASES[progress.phase] || progress.phase;
    $('statFiles').textContent = progress.files.toLocaleString();
    $('statFolders').textContent = (progress.folders || 0).toLocaleString();
}

function scanFinished(message) {
    $('scanProgress').hidden = true;
    $('cancelScan').disabled = true;
    $('scanPhase').textContent = message;
}

function onScanDone(view) {
    state.view = view;
    const seconds = (view.stats.durationMs / 1000).toFixed(1);
    scanFinished(`Done in ${seconds} s · ${view.notes.reusedFromStore.toLocaleString()} unchanged files reused from the last scan`);
    $('statFiles').textContent = view.stats.files.toLocaleString();
    $('statFolders').textContent = view.notes.folders.toLocaleString();
    $('statProjects').textContent = (view.notes.typeCounts.projects || 0).toLocaleString();
    $('statSongs').textContent = view.baselines.preserve.groups.length.toLocaleString();
    $('statCost').textContent = `$${view.stats.aiCostUsd.toFixed(2)}`;
    $('viewCatalog').hidden = false;
    renderCatalog();
}

// ── Screen 3 ──

function renderCatalog() {
    const view = state.view;
    if (!view) return;
    const filesById = new Map(view.files.map((file) => [file.fileId, file]));
    const baseline = view.baselines[state.mode];
    const songs = baseline.groups.map((group) => ({ name: group.songName, files: group.fileIds.map((id) => filesById.get(id)) }));
    songs.sort((a, b) => (state.sort === 'files' ? b.files.length - a.files.length : 0) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

    $('catalogEmpty').hidden = true;
    $('catalogView').hidden = false;
    $('catalogTitle').textContent = view.roots.map((root) => root.name).join(' · ');
    $('catalogCount').textContent = `${songs.length.toLocaleString()} songs · ${view.stats.files.toLocaleString()} files`;
    const placeholders = view.notes.placeholdersFound;
    $('catalogSummary').textContent = [
        `${baseline.tier3Count} ambiguous singletons`,
        placeholders ? `${placeholders} cloud placeholder${placeholders === 1 ? '' : 's'} ${view.stats.placeholdersSkipped ? 'left out' : 'listed'}` : null,
        view.notes.symlinksSkipped ? `${view.notes.symlinksSkipped} symlinks skipped` : null
    ]
        .filter(Boolean)
        .join(' · ');

    $('catalogRows').innerHTML = songs
        .map(
            (song) => `<tr class="datatable-row">
                <td class="song-name-cell" data-column="song_name">
                    <div class="track-name-content flex-1 min-w-0">
                        <div class="song-name-line flex items-center gap-1">
                            <p class="text-sm text-dark-text truncate">${escapeHtml(song.name)}</p>
                            ${song.files.some((file) => file.cloudPlaceholder) ? '<span class="std-chip">Cloud</span>' : ''}
                        </div>
                        <div class="lab-row-meta">${escapeHtml(countsLine(song.files))}</div>
                    </div>
                </td>
                <td data-column="band"><span class="std-chip">Baseline</span></td>
                <td data-column="confidence" class="lab-muted">—</td>
                <td data-column="files">${song.files.length}</td>
                <td data-column="bpm" class="lab-muted">—</td>
                <td data-column="key" class="lab-muted">—</td>
                <td data-column="length" class="lab-muted">—</td>
            </tr>`
        )
        .join('');

    const grouped = new Set(baseline.groups.flatMap((group) => group.fileIds));
    const leftovers = view.files.filter((file) => !grouped.has(file.fileId));
    $('unassignedList').innerHTML = leftovers.length
        ? leftovers
              .map(
                  (file) => `<div class="std-list-row">
                    <span class="std-list-label">${escapeHtml(file.name)}<br /><span class="std-list-meta">${escapeHtml(file.sourceRelativePath)} · ${escapeHtml(file.classifierReason)}</span></span>
                </div>`
              )
              .join('')
        : '<div class="std-list-row"><span class="std-list-meta">Every file was grouped.</span></div>';
}

// ── Wiring ──

document.querySelector('nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-screen]');
    if (button) showScreen(button.dataset.screen);
});
$('folderList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove]');
    if (button) renderFolders(await api.removeFolder(button.dataset.remove));
});
$('addFolders').addEventListener('click', async () => renderFolders(await api.addFolders()));
$('startScan').addEventListener('click', startScan);
$('cancelScan').addEventListener('click', () => api.cancelScan());
$('viewCatalog').addEventListener('click', () => showScreen('catalog'));
document.querySelector('[aria-label="Today\'s importer mode"]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button) return;
    state.mode = button.dataset.mode;
    for (const other of button.parentElement.children) other.classList.toggle('is-active', other === button);
    renderCatalog();
});
document.querySelector('#tracksGrid thead').addEventListener('click', (event) => {
    const header = event.target.closest('[data-sort]');
    if (!header) return;
    state.sort = header.dataset.sort;
    renderCatalog();
});

api.onScanProgress(onProgress);
api.onScanDone(onScanDone);
api.onScanCancelled(() => scanFinished('Cancelled. Nothing was changed.'));
api.onScanFailed((message) => scanFinished(`Scan failed: ${message}`));

api.listFolders().then(renderFolders);
api.getInfo().then((info) => {
    $('runtimeInfo').textContent = `Electron ${info.electron} · Node ${info.node} · SQLite ${info.sqlite} · app ${info.pinnedCommit.slice(0, 8)}`;
});
