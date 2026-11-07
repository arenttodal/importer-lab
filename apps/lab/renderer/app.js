'use strict';

// The producer's flow: welcome → folders → (permission) → scanning → catalog → song detail.
// Lab tools (compare, options, metrics, logs) only when switched on in Settings.
// Plain DOM code; all data arrives through window.labAPI without absolute paths.

const api = window.labAPI;
const $ = (id) => document.getElementById(id);

const state = { folders: [], view: null, marks: [], song: null, settings: { showLabTools: false, scanOptions: {} }, liveSongs: [], showAllLive: false, scanning: false };

const TYPE_LABEL = { bounces: 'Bounce', stems: 'Stem', projects: 'Project', videos: 'Video', unknown: 'Other' };
const MARK_LABEL = {
    'wrong-song': { song: 'Not a real song', file: 'In the wrong song' },
    split: { song: 'Should be split' },
    merge: { song: 'Should be merged' }
};
const LIVE_SONGS_SHOWN = 20;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function cleanError(error) {
    return String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ── Navigation: Back returns to the previous step; Home and New scan are always one click away ──

const nav = { current: 'welcome', stack: [] };

function show(name) {
    nav.current = name;
    for (const panel of document.querySelectorAll('[data-screen]')) panel.hidden = panel.dataset.screen !== name;
    document.querySelector('.lab-main').scrollTop = 0;
    const home = name === 'welcome';
    $('navBack').hidden = nav.stack.length === 0;
    $('navHome').hidden = home;
    $('navNewScan').hidden = home;
}

// The permission note is a one-off step: Back never returns to it.
function navigate(name) {
    if (name === nav.current) return;
    if (nav.current !== 'permission') nav.stack.push(nav.current);
    show(name);
}

// Leaving a running scan stops it; nothing has been changed on disk either way.
function leaveScan() {
    if (state.scanning) api.cancelScan();
}

function goBack() {
    leaveScan();
    const previous = nav.stack.pop() || 'welcome';
    if (previous === 'welcome') renderHistory();
    show(previous);
}

async function goHome() {
    leaveScan();
    nav.stack = [];
    const scans = await renderHistory();
    show('welcome');
    return scans;
}

async function newScan() {
    leaveScan();
    renderFolders(await api.listFolders());
    nav.stack = ['welcome'];
    show('folders');
}

// ── Home: previous scans ──

async function renderHistory() {
    const scans = await api.listScans();
    $('scanHistory').hidden = scans.length === 0;
    $('welcomeStart').textContent = scans.length ? 'New scan' : 'Find my songs';
    $('scanHistoryList').innerHTML = scans
        .map((scan) => {
            const when = new Date(scan.finishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
            return `<div class="std-list-row lab-history-row">
                <span class="std-list-label">${escapeHtml(scan.folders.join(', '))}<br /><span class="std-list-meta">${escapeHtml(when)} · ${scan.songs.toLocaleString()} songs from ${scan.files.toLocaleString()} files</span></span>
                <button class="std-modal-btn std-modal-btn--secondary" type="button" data-open-scan="${escapeHtml(scan.scanId)}">Open</button>
                <button class="std-inline-btn std-inline-btn--destructive" type="button" data-delete-scan="${escapeHtml(scan.scanId)}">Delete</button>
            </div>`;
        })
        .join('');
    return scans;
}

async function openPreviousScan(scanId) {
    const { view, marks } = await api.openScan(scanId);
    state.view = view;
    state.marks = marks;
    renderCatalog();
    renderLab();
    navigate('catalog');
}

function confirmDeleteScan(scanId) {
    const body = document.createElement('p');
    body.className = 'lab-lede';
    body.textContent = 'This removes the saved results of this scan from the lab. Your music files are not touched. Marks you made stay saved.';
    const modal = window.createStandardModal({
        archetype: 'compact',
        title: 'Delete these results?',
        body,
        closeOnBackdrop: false,
        primaryAction: { label: 'Keep', onClick: () => modal.close() },
        destructiveAction: {
            label: 'Delete',
            onClick: async ({ close }) => {
                await api.deleteScan(scanId);
                await renderHistory();
                close();
            }
        }
    });
}

// ── Choose where your music lives ──

const KIND_HINT = { suggested: 'On this Mac', drive: 'Drive', added: 'Added by you' };

function renderFolders(folders) {
    state.folders = folders;
    $('folderList').innerHTML = folders
        .map(
            (folder) => `<label class="std-list-row lab-folder-row">
                <input class="lab-checkbox" type="checkbox" data-folder="${escapeHtml(folder.id)}" ${folder.checked ? 'checked' : ''} />
                <span class="std-list-label">${escapeHtml(folder.name)}<br /><span class="std-list-meta">${KIND_HINT[folder.kind]}</span></span>
                ${folder.kind === 'added' ? `<button class="std-inline-btn" type="button" data-remove="${escapeHtml(folder.id)}">Remove</button>` : ''}
            </label>`
        )
        .join('');
    $('foldersContinue').disabled = !folders.some((folder) => folder.checked);
}

async function continueFromFolders() {
    $('foldersError').hidden = true;
    if (await api.needsPermissionNotice()) return navigate('permission');
    startScan();
}

// ── Scanning ──

function resetScanScreen() {
    for (const id of ['countBounces', 'countProjects', 'countStems', 'countSongs']) $(id).textContent = '0';
    state.liveSongs = [];
    state.showAllLive = false;
    renderLiveSongs();
    $('scanHeading').textContent = 'Looking for your songs';
    $('liveSongsLabel').textContent = 'Songs found so far';
    $('scanPhase').textContent = 'Reading folders…';
    $('scanProgress').hidden = false;
    $('cancelScan').hidden = false;
    $('seeCatalog').hidden = true;
}

async function startScan() {
    try {
        await api.startScan();
        state.scanning = true;
    } catch (error) {
        $('foldersError').textContent = cleanError(error);
        $('foldersError').hidden = false;
        navigate('folders');
        return;
    }
    resetScanScreen();
    navigate('scanning');
}

const PHASE_TEXT = {
    crawl: 'Reading folders…',
    placeholders: 'Checking which files are only in the cloud…',
    baseline: 'Putting files together into songs…',
    done: 'Done'
};

// Newest first; the first 20 unless "See all" was clicked.
function renderLiveSongs() {
    const newestFirst = [...state.liveSongs].reverse();
    const shown = state.showAllLive ? newestFirst : newestFirst.slice(0, LIVE_SONGS_SHOWN);
    $('liveSongs').innerHTML = shown.map((name) => `<span class="std-chip lab-live-chip">${escapeHtml(name)}</span>`).join('');
    $('liveSongsMore').textContent = state.showAllLive ? 'Show fewer' : `See all ${newestFirst.length.toLocaleString()}`;
    $('liveSongsMore').hidden = newestFirst.length <= LIVE_SONGS_SHOWN;
}

function addLiveSongs(names) {
    state.liveSongs.push(...names);
    renderLiveSongs();
}

function onProgress(progress) {
    $('scanPhase').textContent = `${PHASE_TEXT[progress.phase] || progress.phase} ${progress.files.toLocaleString()} files so far.`;
    const counts = progress.typeCounts || {};
    $('countBounces').textContent = (counts.bounces || 0).toLocaleString();
    $('countProjects').textContent = (counts.projects || 0).toLocaleString();
    $('countStems').textContent = (counts.stems || 0).toLocaleString();
    $('countSongs').textContent = (progress.songsFound || 0).toLocaleString();
    if (progress.newSongs?.length) addLiveSongs(progress.newSongs);
}

function scanEnded(text) {
    state.scanning = false;
    $('scanProgress').hidden = true;
    $('cancelScan').hidden = true;
    $('scanPhase').textContent = text;
}

function onScanDone({ view, marks }) {
    state.view = view;
    state.marks = marks;
    $('countSongs').textContent = view.songs.length.toLocaleString();
    scanEnded(`Found ${view.songs.length.toLocaleString()} songs in ${view.stats.files.toLocaleString()} files (${(view.stats.durationMs / 1000).toFixed(1)} s).`);
    $('seeCatalog').hidden = false;
    $('scanHeading').textContent = 'Your songs are ready';
    $('liveSongsLabel').textContent = 'Songs found';
    renderCatalog();
    renderLab();
    renderHistory();
}

// ── Your catalog ──

function marksFor(target, songName, fileId = null) {
    return state.marks.filter((mark) => mark.target === target && mark.songName === songName && (target === 'song' || mark.fileId === fileId));
}

function markChips(marks) {
    return marks
        .map((mark) => {
            const label = MARK_LABEL[mark.kind][mark.target] + (mark.mergeWithSongName ? ` with ${mark.mergeWithSongName}` : '');
            return `<span class="std-chip lab-mark">${escapeHtml(label)} <button class="std-inline-btn" type="button" data-undo="${escapeHtml(mark.id)}">Undo</button></span>`;
        })
        .join('');
}

function songRow(song) {
    const cloud = song.reasons.some((reason) => reason.includes('in the cloud'));
    return `<tr class="datatable-row" data-song="${escapeHtml(song.key)}">
        <td class="song-name-cell" data-column="song_name">
            <div class="track-name-content flex-1 min-w-0">
                <div class="song-name-line flex items-center gap-1">
                    <p class="text-sm text-dark-text truncate">${escapeHtml(song.name)}</p>
                    ${cloud ? '<span class="std-chip">Cloud</span>' : ''}
                    ${markChips(marksFor('song', song.name))}
                </div>
                <div class="lab-row-meta">${escapeHtml(song.countsLine)}</div>
            </div>
        </td>
        <td data-column="files">${song.fileIds.length}</td>
        <td data-column="actions" class="lab-cell-actions"><button class="std-inline-btn" type="button" data-wrong-song="${escapeHtml(song.key)}">This is wrong</button></td>
    </tr>`;
}

function groupRows(label, songs) {
    if (!songs.length) return '';
    return `<tr class="lab-group-row"><td colspan="3"><div class="std-modal-section-label">${escapeHtml(label)} · ${songs.length}</div></td></tr>${songs.map(songRow).join('')}`;
}

function renderCatalog() {
    const view = state.view;
    if (!view) return;
    const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    const unsure = view.songs.filter((song) => song.unsure).sort(byName);
    const sure = view.songs.filter((song) => !song.unsure).sort(byName);
    const where = view.roots.map((root) => root.name).join(', ');
    $('catalogCount').textContent = `${view.songs.length.toLocaleString()} songs from ${view.stats.files.toLocaleString()} files in ${where}.`;
    $('catalogRows').innerHTML = groupRows('Check these first', unsure) + groupRows('Songs', sure);
    $('otherFiles').textContent = view.otherFiles ? `${view.otherFiles.toLocaleString()} other files (documents, images and so on) were left out.` : '';
    const unreadable = view.notes.unreadableFolders;
    $('unreadableAlert').hidden = unreadable === 0;
    $('unreadableText').textContent = `${unreadable} folder${unreadable === 1 ? ' was' : 's were'} not readable, probably because access was not allowed.`;
}

// ── Song detail ──

function folderOf(file) {
    const parts = file.sourceRelativePath.split('/');
    return parts.slice(0, -1).join(' / ');
}

function openSong(key) {
    const song = state.view.songs.find((candidate) => candidate.key === key);
    if (!song) return;
    state.song = song;
    renderSong();
    navigate('song');
}

function renderSong() {
    const song = state.song;
    const filesById = new Map(state.view.files.map((file) => [file.fileId, file]));
    $('songTitle').textContent = song.name;
    $('songCounts').textContent = song.countsLine;
    $('songActions').innerHTML = `${markChips(marksFor('song', song.name))}<button class="std-modal-btn std-modal-btn--secondary" type="button" data-wrong-song="${escapeHtml(song.key)}">This is wrong</button>`;
    $('songReasons').innerHTML = song.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
    $('songFiles').innerHTML = song.fileIds
        .map((id) => filesById.get(id))
        .map(
            (file) => `<tr class="datatable-row">
                <td><span class="std-chip">${TYPE_LABEL[file.type]}</span></td>
                <td>
                    <div class="text-sm text-dark-text">${escapeHtml(file.name)} ${file.cloudPlaceholder ? '<span class="std-chip">Cloud</span>' : ''} ${markChips(marksFor('file', song.name, file.fileId))}</div>
                    <div class="lab-row-meta">${escapeHtml(file.classifierReason)}${file.needsReview ? ' · type is a guess' : ''}</div>
                </td>
                <td class="lab-muted">${escapeHtml(folderOf(file))}</td>
                <td class="lab-muted">${escapeHtml(new Date(file.modifiedAt).toLocaleDateString())}</td>
                <td class="lab-cell-actions"><button class="std-inline-btn" type="button" data-wrong-file="${escapeHtml(file.fileId)}">This is wrong</button></td>
            </tr>`
        )
        .join('');
}

// ── "This is wrong" marks: click once to open the menu, click once to choose ──

function refreshAfterMark() {
    renderCatalog();
    if (state.song && !$('songTitle').closest('[data-screen]').hidden) renderSong();
}

async function saveMark(input) {
    const mark = await api.addMark(input);
    state.marks.push(mark);
    refreshAfterMark();
    window.showToast?.('Saved. Thank you — this goes in the results you send.', 'success');
    return mark;
}

function openMenu(anchor, items) {
    const menu = document.createElement('div');
    menu.innerHTML = items.map((item, index) => `<button class="std-menu-item" role="menuitem" type="button" data-item="${index}">${escapeHtml(item.label)}</button>`).join('');
    let close = null;
    menu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-item]');
        if (!button) return;
        close();
        items[Number(button.dataset.item)].onSelect();
    });
    close = window.openStandardMenu(menu, anchor, { align: 'end' });
}

function songMenu(anchor, song) {
    openMenu(anchor, [
        { label: 'Should be split — these are not all one song', onSelect: () => saveMark({ kind: 'split', target: 'song', songName: song.name }) },
        {
            label: 'Should be merged with…',
            onSelect: async () => openMergePicker(song, await saveMark({ kind: 'merge', target: 'song', songName: song.name }))
        },
        { label: 'Not a real song', onSelect: () => saveMark({ kind: 'wrong-song', target: 'song', songName: song.name }) }
    ]);
}

function fileMenu(anchor, file) {
    openMenu(anchor, [
        { label: 'In the wrong song', onSelect: () => saveMark({ kind: 'wrong-song', target: 'file', songName: state.song.name, fileId: file.fileId, fileName: file.name, fileType: file.type }) }
    ]);
}

function openMergePicker(song, mark) {
    let chosen = null;
    const body = document.createElement('div');
    body.className = 'lab-picker';
    body.innerHTML = `<input class="std-form-input" type="search" placeholder="Find a song" aria-label="Find a song" /><div class="std-list lab-picker-list"></div>`;
    const input = body.querySelector('input');
    const list = body.querySelector('.std-list');
    const others = state.view.songs.filter((candidate) => candidate.key !== song.key).sort((a, b) => a.name.localeCompare(b.name));
    function renderList() {
        const query = input.value.trim().toLowerCase();
        list.innerHTML = others
            .filter((candidate) => candidate.name.toLowerCase().includes(query))
            .slice(0, 100)
            .map((candidate) => `<button class="std-list-row lab-pick${candidate.name === chosen ? ' is-active' : ''}" type="button" data-pick="${escapeHtml(candidate.name)}"><span class="std-list-label">${escapeHtml(candidate.name)}</span><span class="std-list-meta">${escapeHtml(candidate.countsLine)}</span></button>`)
            .join('');
    }
    const modal = window.createStandardModal({
        archetype: 'standard',
        title: 'Same song as…',
        subtitle: `“${song.name}” should be merged with:`,
        body,
        primaryAction: {
            label: 'Save',
            onClick: async () => {
                const updated = await api.updateMark(mark.id, { mergeWithSongName: chosen });
                Object.assign(state.marks.find((candidate) => candidate.id === mark.id), updated);
                refreshAfterMark();
                modal.close();
            }
        }
    });
    modal.setPrimaryDisabled(true);
    list.addEventListener('click', (event) => {
        const button = event.target.closest('[data-pick]');
        if (!button) return;
        chosen = button.dataset.pick;
        modal.setPrimaryDisabled(false);
        renderList();
    });
    input.addEventListener('input', renderList);
    renderList();
    input.focus();
}

async function undoMark(markId) {
    await api.removeMark(markId);
    state.marks = state.marks.filter((mark) => mark.id !== markId);
    refreshAfterMark();
}

// ── Send results to the team ──

async function exportResults() {
    try {
        const { fileName } = await api.exportResults();
        window.showToast?.(`Saved “${fileName}” and opened it in Finder. Attach it to a message to the team.`, 'success');
    } catch (error) {
        window.showToast?.(cleanError(error), 'error');
    }
}

// ── Settings and Lab tools ──

function applySettings(settings) {
    state.settings = settings;
    $('openLab').hidden = !settings.showLabTools;
    for (const input of document.querySelectorAll('input[name="mergeRule"], input[name="includeCloudPlaceholders"]')) {
        input.checked = settings.scanOptions[input.name] === input.value;
    }
}

function openSettings() {
    const body = document.createElement('div');
    body.innerHTML = `<label class="std-toggle">
            <input class="std-toggle-input" type="checkbox" ${state.settings.showLabTools ? 'checked' : ''} />
            <span class="std-toggle-rail"></span>
            <span class="std-toggle-label">Show Lab tools</span>
        </label>
        <p class="std-form-help">Adds a Lab menu for the team: compare with today's importer, scan options, metrics and logs.</p>`;
    body.querySelector('input').addEventListener('change', async (event) => applySettings(await api.setSetting('showLabTools', event.target.checked)));
    const modal = window.createStandardModal({ archetype: 'compact', title: 'Settings', body, primaryAction: { label: 'Done', onClick: () => modal.close() } });
}

function showLabSection(section) {
    for (const button of document.querySelectorAll('[data-lab]')) button.classList.toggle('is-active', button.dataset.lab === section);
    for (const panel of document.querySelectorAll('[data-lab-panel]')) panel.hidden = panel.dataset.labPanel !== section;
}

function compareLabel(group, stripByFile) {
    const stripGroups = new Set(group.fileIds.map((id) => stripByFile.get(id)));
    if (stripGroups.size > 1) return 'Split';
    const [other] = stripGroups;
    if (other.fileIds.length > group.fileIds.length) return 'Merged';
    return other.songName === group.songName ? 'Same' : 'Renamed';
}

function renderLab() {
    const view = state.view;
    if (!view) return;
    const { preserve, strip } = view.baselines;
    const stripByFile = new Map(strip.groups.flatMap((group) => group.fileIds.map((id) => [id, group])));
    const tile = (value, label) => `<div class="std-stat-tile"><div class="std-stat-value">${value}</div><div class="std-stat-label">${label}</div></div>`;
    $('compareStats').innerHTML = tile(view.stats.files, 'Files') + tile(preserve.groups.length, 'Songs, keep prefixes') + tile(strip.groups.length, 'Songs, strip prefixes') + tile(`${preserve.tier3Count} / ${strip.tier3Count}`, 'Ambiguous singletons');
    $('compareRows').innerHTML = [...preserve.groups]
        .sort((a, b) => a.songName.localeCompare(b.songName))
        .map((group) => {
            const label = compareLabel(group, stripByFile);
            const stripNames = [...new Set(group.fileIds.map((id) => stripByFile.get(id).songName))];
            return `<tr class="datatable-row"><td>${escapeHtml(group.songName)} <span class="lab-muted">(${group.fileIds.length})</span></td><td>${label === 'Same' ? '' : `<span class="std-chip">${label}</span> `}${stripNames.map(escapeHtml).join(', ')}</td></tr>`;
        })
        .join('');
    api.getInfo().then((info) => {
        const rows = [
            ['Files', view.stats.files],
            ['Folders read', view.notes.folders],
            ['Folders not readable', view.notes.unreadableFolders],
            ['Symlinks skipped', view.notes.symlinksSkipped],
            ['Cloud placeholders', view.notes.placeholdersFound],
            ['Reused from the last scan', view.notes.reusedFromStore],
            ['Scan time', `${(view.stats.durationMs / 1000).toFixed(2)} s`],
            ['AI cost', `$${view.stats.aiCostUsd.toFixed(2)}`],
            ['Engine', view.engineVersion],
            ['Contract', view.contractVersion],
            ['Main app commit', info.pinnedCommit.slice(0, 8)],
            ['Electron / Node / SQLite', `${info.electron} / ${info.node} / ${info.sqlite}`],
            ['Network requests blocked', info.blockedRequests]
        ];
        $('metricsRows').innerHTML = rows.map(([key, value]) => `<tr><td class="lab-muted">${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join('');
    });
    $('logText').textContent = [...view.notes.baselineLog, '', JSON.stringify({ typeCounts: view.notes.typeCounts, stats: view.stats }, null, 2)].join('\n');
}

// ── Wiring ──

$('welcomeStart').addEventListener('click', newScan);
$('navBack').addEventListener('click', goBack);
$('navHome').addEventListener('click', goHome);
$('navNewScan').addEventListener('click', newScan);
$('liveSongsMore').addEventListener('click', () => {
    state.showAllLive = !state.showAllLive;
    renderLiveSongs();
});
$('scanHistoryList').addEventListener('click', (event) => {
    const open = event.target.closest('[data-open-scan]');
    if (open) return openPreviousScan(open.dataset.openScan);
    const remove = event.target.closest('[data-delete-scan]');
    if (remove) confirmDeleteScan(remove.dataset.deleteScan);
});
$('folderList').addEventListener('change', async (event) => {
    const box = event.target.closest('[data-folder]');
    if (box) renderFolders(await api.setFolderChecked(box.dataset.folder, box.checked));
});
$('folderList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    event.preventDefault();
    renderFolders(await api.removeFolder(button.dataset.remove));
});
$('addFolders').addEventListener('click', async () => renderFolders(await api.addFolders()));
const dropZone = $('dropZone');
dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.dataset.selected = 'true';
});
dropZone.addEventListener('dragleave', () => delete dropZone.dataset.selected);
dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    delete dropZone.dataset.selected;
    renderFolders(await api.addDropped(event.dataTransfer.files));
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());
$('foldersContinue').addEventListener('click', continueFromFolders);
$('permissionContinue').addEventListener('click', async () => {
    await api.permissionExplained();
    startScan();
});
$('cancelScan').addEventListener('click', () => api.cancelScan());
$('seeCatalog').addEventListener('click', () => navigate('catalog'));
$('rescan').addEventListener('click', newScan);
$('exportResults').addEventListener('click', exportResults);
$('openPrivacy').addEventListener('click', () => api.openPrivacySettings());
document.querySelector('.lab-main').addEventListener('click', (event) => {
    const undo = event.target.closest('[data-undo]');
    if (undo) return undoMark(undo.dataset.undo);
    const wrongSong = event.target.closest('[data-wrong-song]');
    if (wrongSong) return songMenu(wrongSong, state.view.songs.find((song) => song.key === wrongSong.dataset.wrongSong));
    const wrongFile = event.target.closest('[data-wrong-file]');
    if (wrongFile) return fileMenu(wrongFile, state.view.files.find((file) => file.fileId === wrongFile.dataset.wrongFile));
    const row = event.target.closest('tr[data-song]');
    if (row) openSong(row.dataset.song);
});
$('openSettings').addEventListener('click', openSettings);
$('openLab').addEventListener('click', () => navigate('lab'));
document.querySelector('[aria-label="Lab sections"]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-lab]');
    if (button) showLabSection(button.dataset.lab);
});
for (const input of document.querySelectorAll('input[name="mergeRule"], input[name="includeCloudPlaceholders"]')) {
    input.addEventListener('change', async () => applySettings(await api.setSetting(input.name, input.value)));
}

api.onScanProgress(onProgress);
api.onScanDone(onScanDone);
api.onScanCancelled(() => {
    scanEnded('Cancelled. Nothing was changed.');
    $('seeCatalog').hidden = !state.view;
});
api.onScanFailed((message) => scanEnded(`The scan stopped: ${message}`));
api.onOpenSettings(openSettings);
api.onOpenLab((section) => {
    if (!state.settings.showLabTools) return;
    showLabSection(section);
    navigate('lab');
});
api.onNewScan(newScan);
api.onOpenPrevious(async () => {
    const scans = await goHome();
    if (!scans?.length) window.showToast?.('No previous scans yet.', 'info');
});
api.getSettings().then(applySettings);
renderHistory();
