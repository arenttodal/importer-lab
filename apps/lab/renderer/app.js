'use strict';

// The producer's flow: welcome → folders → (permission) → scanning → catalog → song detail.
// Lab tools (compare, options, metrics, logs) only when switched on in Settings.
// Plain DOM code; all data arrives through window.labAPI without absolute paths.

const api = window.labAPI;
const $ = (id) => document.getElementById(id);

const state = { folders: [], view: null, marks: [], song: null, settings: { showLabTools: false, scanOptions: {} }, liveSongs: [], showAllLive: false, scanning: false, showOtherKinds: false };

const KIND_LABEL = { template: 'Template', course: 'Course', 'sample-pack': 'Sample pack', 'stem-set': 'Stems only', 'loose-stems': 'Loose stems' };
const BAND_LABEL = { unsure: 'Check', unclear: 'Unclear' };

const TYPE_LABEL = { bounces: 'Bounce', stems: 'Stem', projects: 'Project', videos: 'Video', unknown: 'Other' };
const MARK_LABEL = {
    'wrong-song': { song: 'Not a real song', file: 'In the wrong song' },
    split: { song: 'Should be split' },
    merge: { song: 'Should be merged' },
    right: { song: 'Right' }
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
    state.check = null;
    const previous = nav.stack.pop() || 'welcome';
    if (previous === 'welcome') renderHistory();
    show(previous);
}

async function goHome() {
    state.check = null;
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

async function startScan(options = {}) {
    try {
        await api.startScan(options);
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
    clues: 'Reading projects and audio lengths (files on this Mac only)…',
    baseline: "Running today's importer for comparison…",
    grouping: 'Putting files together into songs…',
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
    // The final list: names seen while scanning that are still songs, then any the last pass found.
    const finalNames = view.songs.filter((song) => song.kind === 'song').map((song) => song.name);
    const finalSet = new Set(finalNames);
    const kept = [...new Set(state.liveSongs)].filter((name) => finalSet.has(name));
    const keptSet = new Set(kept);
    state.liveSongs = [...kept, ...[...finalSet].filter((name) => !keptSet.has(name))];
    renderLiveSongs();
    $('countSongs').textContent = view.stats.songs.toLocaleString();
    scanEnded(`Found ${view.stats.songs.toLocaleString()} songs in ${view.stats.files.toLocaleString()} files (${(view.stats.durationMs / 1000).toFixed(1)} s).`);
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
    const chips = [
        song.kind !== 'song' ? `<span class="std-chip">${KIND_LABEL[song.kind]}</span>` : '',
        song.kind === 'song' && BAND_LABEL[song.band] ? `<span class="std-chip">${BAND_LABEL[song.band]}</span>` : '',
        song.review ? '<span class="std-chip">Review</span>' : '',
        song.existingSongId ? '<span class="std-chip">In your Library</span>' : '',
        cloud ? '<span class="std-chip">Cloud</span>' : ''
    ].join('');
    const versions = song.versions.length > 1 ? ` · ${song.versions.length} versions` : '';
    const matches = song.possibleMatches.length ? ` · might match ${song.possibleMatches.length}` : '';
    return `<tr class="datatable-row" data-song="${escapeHtml(song.key)}">
        <td class="song-name-cell" data-column="song_name">
            <div class="track-name-content flex-1 min-w-0">
                <div class="song-name-line flex items-center gap-1">
                    <p class="text-sm text-dark-text truncate">${escapeHtml(song.name)}</p>
                    ${chips}
                    ${markChips(marksFor('song', song.name))}
                </div>
                <div class="lab-row-meta">${escapeHtml(song.countsLine + versions + matches)}</div>
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
    const songs = view.songs.filter((song) => song.kind === 'song');
    const check = songs.filter((song) => song.band !== 'sure').sort((a, b) => (a.band === b.band ? Number(b.precheck) - Number(a.precheck) || byName(a, b) : a.band === 'unsure' ? -1 : 1));
    const sure = songs.filter((song) => song.band === 'sure').sort(byName);
    const loose = view.songs.filter((song) => song.kind === 'loose-stems' || (song.kind !== 'song' && song.review));
    const others = view.songs.filter((song) => song.kind !== 'song' && song.kind !== 'loose-stems' && !song.review).sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b));
    const where = view.roots.map((root) => root.name).join(', ');
    $('catalogCount').textContent = `${songs.length.toLocaleString()} songs from ${view.stats.files.toLocaleString()} files in ${where}.`;
    $('catalogRows').innerHTML = groupRows('Check these first', [...loose, ...check]) + groupRows('Songs', sure) + (state.showOtherKinds ? groupRows('Not counted as songs', others) : '');
    const kindCounts = {};
    for (const song of others) kindCounts[song.kind] = (kindCounts[song.kind] || 0) + 1;
    const summary = Object.entries(kindCounts).map(([kind, count]) => `${count} ${KIND_LABEL[kind].toLowerCase()}${count === 1 ? '' : 's'}`).join(', ');
    $('toggleOtherKinds').hidden = others.length === 0;
    $('toggleOtherKinds').textContent = state.showOtherKinds ? 'Hide templates, course material, sample packs and stem sets' : `Show what is not counted as songs (${summary})`;
    $('otherFiles').textContent = view.otherFiles ? `${view.otherFiles.toLocaleString()} other files (documents, images and so on) were left out.` : '';
    renderCourseSuggestions(view);
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

function formatLength(seconds) {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function renderSong() {
    const song = state.song;
    const checking = Boolean(state.check && state.check.keys[state.check.index] === song.key);
    $('checkBar').hidden = !checking;
    if (checking) {
        $('checkProgress').textContent = `Song ${state.check.index + 1} of ${state.check.keys.length}`;
        renderClosest(song);
    }
    const filesById = new Map(state.view.files.map((file) => [file.fileId, file]));
    const facts = [song.facts.bpm ? `${song.facts.bpm} BPM` : null, song.facts.lengthSec ? formatLength(song.facts.lengthSec) : null].filter(Boolean).join(' · ');
    const band = song.kind !== 'song' ? KIND_LABEL[song.kind] : { sure: 'Sure', unsure: 'Check this', unclear: 'Unclear' }[song.band];
    $('songTitle').textContent = song.name;
    $('songCounts').textContent = [song.countsLine, facts, band].filter(Boolean).join(' · ');
    $('songActions').innerHTML = `${markChips(marksFor('song', song.name))}<button class="std-modal-btn std-modal-btn--secondary" type="button" data-wrong-song="${escapeHtml(song.key)}">This is wrong</button>`;
    $('songReasons').innerHTML = song.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');

    $('songMatchesBlock').hidden = song.possibleMatches.length === 0;
    $('songMatches').innerHTML = song.possibleMatches
        .map((match) => `<button class="std-list-row lab-pick" type="button" data-open-song="${escapeHtml(match.proposalId)}"><span class="std-list-label">${escapeHtml(match.songName)}</span><span class="std-list-meta">${escapeHtml(match.reason)}</span></button>`)
        .join('');

    const versions = song.versions.filter((version) => version.fileIds.length);
    $('songVersionsBlock').hidden = versions.length < 2;
    $('songVersions').innerHTML = versions
        .map((version) => `<div class="std-list-row"><span class="std-list-label">${escapeHtml(version.label)}<br /><span class="std-list-meta">${version.fileIds.map((id) => escapeHtml(filesById.get(id)?.name || '')).join(' · ')}</span></span></div>`)
        .join('');

    $('songStemsBlock').hidden = song.stemSets.length === 0;
    $('songStems').innerHTML = song.stemSets
        .map((set) => {
            const parts = set.fileIds.map((id) => filesById.get(id)).map((file) => escapeHtml(file?.stemPart || file?.name || '')).join(' · ');
            const mix = set.matchesFileId ? ` · goes with ${escapeHtml(filesById.get(set.matchesFileId)?.name || '')}` : '';
            return `<div class="std-list-row"><span class="std-list-label">${escapeHtml(set.label)} · ${set.fileIds.length} stems<br /><span class="std-list-meta">${parts}${mix}</span></span></div>`;
        })
        .join('');

    $('songFiles').innerHTML = song.fileIds
        .map((id) => filesById.get(id))
        .map(
            (file) => `<tr class="datatable-row">
                <td><span class="std-chip">${file.stemPart ? 'Stem' : TYPE_LABEL[file.type]}</span></td>
                <td>
                    <div class="text-sm text-dark-text">${escapeHtml(file.name)} ${file.latest ? '<span class="std-chip">Latest</span>' : ''} ${file.cloudPlaceholder ? '<span class="std-chip">Cloud</span>' : ''} ${markChips(marksFor('file', song.name, file.fileId))}</div>
                    <div class="lab-row-meta">${escapeHtml([file.versionLabel ? `Version: ${file.versionLabel}` : null, file.stemPart ? `Stem: ${file.stemPart}` : null, file.classifierReason].filter(Boolean).join(' · '))}</div>
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
    if (!input.check) window.showToast?.('Saved. Thank you — this goes in the results you send.', 'success');
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

function openMergePicker(song, mark, afterSave = null) {
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
                if (afterSave) afterSave();
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
    $('groupEdits').checked = settings.scanOptions.groupEdits !== false;
    $('courseNamespaces').value = (settings.scanOptions.courseNamespaces || []).join(', ');
    $('existingSongsStatus').textContent = settings.existingSongs ? `${settings.existingSongs.count.toLocaleString()} songs loaded` : 'None loaded';
    $('clearExistingSongs').hidden = !settings.existingSongs;
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

// For each engine song: did today's importer have it the same, or spread it over several songs
// (the engine merged them), or put part of it into another song (moved)?
function compareRows(view) {
    const todayOf = new Map();
    for (const group of view.baselines.preserve.groups) for (const id of group.fileIds) todayOf.set(id, group);
    return view.songs
        .filter((song) => song.kind === 'song')
        .map((song) => {
            const todays = [...new Set(song.fileIds.map((id) => todayOf.get(id)).filter(Boolean))];
            const outside = todays.some((group) => group.fileIds.some((id) => !song.fileIds.includes(id)));
            const change = todays.length > 1 ? `Merged ${todays.length}` : outside ? 'Split from' : todays[0] && todays[0].songName !== song.name ? 'Renamed' : 'Same';
            return { song, todays, change };
        })
        .sort((a, b) => Number(a.change === 'Same') - Number(b.change === 'Same') || b.todays.length - a.todays.length || a.song.name.localeCompare(b.song.name));
}

function renderLab() {
    const view = state.view;
    if (!view) return;
    const songs = view.songs.filter((song) => song.kind === 'song');
    const count = (band) => songs.filter((song) => song.band === band).length;
    const tile = (value, label) => `<div class="std-stat-tile"><div class="std-stat-value">${value}</div><div class="std-stat-label">${label}</div></div>`;
    $('compareStats').innerHTML =
        tile(view.stats.files.toLocaleString(), 'Files') +
        tile(view.baselines.preserve.groups.length.toLocaleString(), "Songs today") +
        tile(songs.length.toLocaleString(), 'Songs, new engine') +
        tile(`${Math.round(view.stats.autoMatchedShare * 100)}%`, 'Files in sure songs') +
        tile(`${count('unsure')} / ${count('unclear')}`, 'Check / unclear');
    $('compareRows').innerHTML = compareRows(view)
        .slice(0, 500)
        .map(
            ({ song, todays, change }) => `<tr class="datatable-row" data-song="${escapeHtml(song.key)}"><td>${escapeHtml(song.name)} <span class="lab-muted">(${song.fileIds.length})</span></td><td>${change === 'Same' ? '' : `<span class="std-chip">${escapeHtml(change)}</span>`}</td><td>${todays.map((group) => escapeHtml(group.songName)).join(', ')}</td></tr>`
        )
        .join('');
    const kinds = {};
    for (const song of view.songs) kinds[song.kind] = (kinds[song.kind] || 0) + 1;
    const marks = state.marks;
    Promise.all([api.getInfo(), api.checkSummary()]).then(([info, summary]) => {
        const rows = [
            ['Files', view.stats.files],
            ['Songs: new engine / today', `${songs.length} / ${view.baselines.preserve.groups.length}`],
            ['Sure / check / unclear', `${count('sure')} / ${count('unsure')} / ${count('unclear')}`],
            ['Files in sure songs', `${Math.round(view.stats.autoMatchedShare * 100)}%`],
            ['Not counted as songs', Object.entries(kinds).filter(([kind]) => kind !== 'song').map(([kind, number]) => `${number} ${KIND_LABEL[kind].toLowerCase()}`).join(', ') || 'none'],
            ['Checked songs (random, weighted sample)', confidenceText(summary)],
            ['Marks: should be split (false merges)', marks.filter((mark) => mark.kind === 'split').length],
            ['Marks: should be merged (false splits)', marks.filter((mark) => mark.kind === 'merge').length],
            ['Marks: file in the wrong song', marks.filter((mark) => mark.kind === 'wrong-song' && mark.target === 'file').length],
            ['Projects read', view.notes.projectsRead],
            ['Clue links (timing, samples, batches, duplicates)', view.notes.links],
            ['Duplicate sets', view.duplicates],
            ['Contributors learned', view.notes.contributors.join(', ') || 'none'],
            ['Folders read / not readable', `${view.notes.folders} / ${view.notes.unreadableFolders}`],
            ['Cloud placeholders (never opened)', view.notes.placeholdersFound],
            ['Reused from the last scan', view.notes.fromScratch ? 'none (scan from scratch)' : view.notes.reusedFromStore],
            ['Scan time', `${(view.stats.durationMs / 1000).toFixed(2)} s`],
            ...timingRows(view.notes.timings || {}, view.notes.clueCounts || {}),
            ['AI cost', `$${view.stats.aiCostUsd.toFixed(2)}`],
            ['Engine / name and scoring policy', `${view.engineVersion} / ${view.policyVersion}`],
            ['Contract', view.contractVersion],
            ['Main app commit', info.pinnedCommit.slice(0, 8)],
            ['Electron / Node / SQLite', `${info.electron} / ${info.node} / ${info.sqlite}`],
            ['Network requests blocked', info.blockedRequests]
        ];
        $('metricsRows').innerHTML = rows.map(([key, value]) => `<tr><td class="lab-muted">${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join('');
    });
    $('logText').textContent = [...view.notes.baselineLog, '', JSON.stringify({ typeCounts: view.notes.typeCounts, stats: view.stats }, null, 2)].join('\n');
}

const TIMING_LABEL = {
    crawlMs: 'Time: reading folders',
    storeLookupMs: 'Time: looking up the last scan (part of reading folders)',
    previewGroupingMs: 'Time: live song list while scanning',
    placeholdersMs: 'Time: checking cloud placeholders',
    readFilesMs: 'Time: reading projects and audio headers',
    linksMs: 'Time: export batches, samples, timing',
    duplicatesMs: 'Time: identical-audio check',
    baselineMs: "Time: today's importer (both modes)",
    groupingMs: 'Time: new engine grouping',
    storeSaveMs: 'Time: saving the scan',
    totalMs: 'Time: total'
};

function timingRows(timings, counts) {
    const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`;
    const rows = Object.keys(TIMING_LABEL)
        .filter((key) => typeof timings[key] === 'number')
        .map((key) => [TIMING_LABEL[key], seconds(timings[key])]);
    if (typeof counts.filesOpened === 'number') {
        rows.push(['Files opened for clues / not opened (stored from the last scan, or in the cloud)', `${counts.filesOpened} / ${counts.filesNotOpened}`]);
        rows.push(['Same-size files: edge-checked / hashed in full', `${counts.sameSizeFilesChecked} / ${counts.filesHashedInFull}`]);
    }
    return rows;
}

// Course and series prefixes the engine found: confirmed ones become course material on the next
// scan; declined ones are never asked again. The manual setting (Lab options) stays an override.
function renderCourseSuggestions(view) {
    const found = (view.notes.courseSuggestions || []).filter((entry) => !(state.settings.scanOptions.declinedCoursePrefixes || []).includes(entry.prefix) && !(state.settings.scanOptions.courseNamespaces || []).includes(entry.prefix));
    $('courseAlert').hidden = found.length === 0;
    if (!found.length) return;
    const shown = (prefix) => prefix.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
    $('courseList').textContent = found.map((entry) => shown(entry.prefix)).join(', ');
    $('courseDetail').textContent = `${found.reduce((sum, entry) => sum + entry.files, 0)} files would move out of your songs.`;
}

function courseSuggestionPrefixes() {
    return (state.view?.notes.courseSuggestions || []).map((entry) => entry.prefix);
}

// ── "Check 30 songs": a random sample, one song at a time, answered with one click ──

// The sample comes from the main process: weighted toward songs to check, unclear songs and songs
// with several files, leaving out songs already checked (apps/lab/src/check.js).
async function startCheck() {
    const picks = await api.checkSample();
    if (!picks.length) return window.showToast?.('Every song has been checked.', 'success');
    state.check = { scanId: state.view.scanId, keys: picks.map((pick) => pick.key), picks: new Map(picks.map((pick) => [pick.key, pick])), index: 0, answers: {} };
    showCheckSong();
}

function showCheckSong() {
    const key = state.check.keys[state.check.index];
    state.song = state.view.songs.find((song) => song.key === key);
    if (nav.current === 'song') {
        renderSong();
        document.querySelector('.lab-main').scrollTop = 0;
    } else {
        renderSong();
        navigate('song');
    }
}

function nextCheckSong() {
    state.check.index += 1;
    if (state.check.index < state.check.keys.length) return showCheckSong();
    const answers = Object.values(state.check.answers);
    const count = (kind) => answers.filter((answer) => answer === kind).length;
    $('checkSummary').textContent = `You checked ${answers.length} of ${state.check.keys.length} songs: ${count('right')} right, ${count('wrong-song')} wrong, ${count('split')} to split, ${count('merge')} to merge. Your answers are saved and go in the results you send.`;
    state.check = null;
    navigate('checkDone');
    api.checkSummary().then((summary) => ($('checkConfidence').textContent = confidenceText(summary)));
}

async function answerCheck(kind) {
    const song = state.song;
    if (kind !== 'skip') {
        const pick = state.check.picks.get(song.key) || {};
        const mark = await saveMark({ kind, target: 'song', songName: song.name, check: true, songBand: song.band, songKind: song.kind, stratum: pick.stratum, sampleWeight: pick.weight });
        state.check.answers[song.key] = kind;
        if (kind === 'merge') return openMergePicker(song, mark, nextCheckSong);
    }
    nextCheckSong();
}

// Songs whose names look most like this one, so a split shows up while checking.
function closestEntries(song, limit = 5) {
    const words = (text) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1));
    const mine = words(song.name);
    return state.view.songs
        .filter((other) => other.key !== song.key)
        .map((other) => {
            const theirs = words(other.name);
            const shared = [...mine].filter((word) => theirs.has(word)).length;
            return { other, score: shared ? (2 * shared) / (mine.size + theirs.size) : 0 };
        })
        .filter((entry) => entry.score >= 0.4)
        .sort((a, b) => b.score - a.score || a.other.name.localeCompare(b.other.name))
        .slice(0, limit)
        .map((entry) => entry.other);
}

function renderClosest(song) {
    const close = closestEntries(song);
    $('checkClosest').innerHTML = close.length
        ? close
              .map((other) => `<div class="std-list-row"><span class="std-list-label">${escapeHtml(other.name)}<br /><span class="std-list-meta">${escapeHtml([other.countsLine, KIND_LABEL[other.kind] || ''].filter(Boolean).join(' · '))}</span></span><button class="std-inline-btn" type="button" data-same-song="${escapeHtml(other.name)}">Same song</button></div>`)
              .join('')
        : '<div class="lab-muted">No other entry has a similar name.</div>';
}

// "27 of 27 right: at least 89% right (95% confidence)". The bound is exact (one-sided).
function confidenceText(summary) {
    if (!summary.answered) return `No songs checked yet. Aim: ${summary.target}.`;
    const bound = summary.lowerBound95 === null ? '' : `: at least ${Math.floor(summary.lowerBound95 * 100)}% right (95% confidence)`;
    const weighted = summary.weightedRightShare === null ? '' : `; weighted to the whole catalog ${Math.round(summary.weightedRightShare * 100)}% right`;
    return `${summary.right} of ${summary.answered} right${bound}${weighted}. ${summary.answered} of ${summary.target} checked.`;
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
$('checkStart').addEventListener('click', startCheck);
$('scanFromScratch').addEventListener('click', () => startScan({ fromScratch: true }));
$('checkBar').addEventListener('click', async (event) => {
    const same = event.target.closest('[data-same-song]');
    if (same && state.check) {
        const song = state.song;
        const pick = state.check.picks.get(song.key) || {};
        const mark = await saveMark({ kind: 'merge', target: 'song', songName: song.name, check: true, songBand: song.band, songKind: song.kind, stratum: pick.stratum, sampleWeight: pick.weight });
        const updated = await api.updateMark(mark.id, { mergeWithSongName: same.dataset.sameSong });
        Object.assign(state.marks.find((candidate) => candidate.id === mark.id), updated);
        state.check.answers[song.key] = 'merge';
        return nextCheckSong();
    }
    const button = event.target.closest('[data-check]');
    if (button && state.check) answerCheck(button.dataset.check);
});
$('checkExport').addEventListener('click', () => $('exportResults').click());
$('checkToCatalog').addEventListener('click', () => {
    nav.stack = ['welcome'];
    show('catalog');
});
$('exportResults').addEventListener('click', exportResults);
$('openPrivacy').addEventListener('click', () => api.openPrivacySettings());
$('toggleOtherKinds').addEventListener('click', () => {
    state.showOtherKinds = !state.showOtherKinds;
    renderCatalog();
});
$('groupEdits').addEventListener('change', async (event) => applySettings(await api.setSetting('groupEdits', event.target.checked)));
$('courseConfirm').addEventListener('click', async () => {
    const merged = [...new Set([...(state.settings.scanOptions.courseNamespaces || []), ...courseSuggestionPrefixes()])];
    applySettings(await api.setSetting('courseNamespaces', merged.join(', ')));
    $('courseAlert').hidden = true;
    startScan();
});
$('courseDecline').addEventListener('click', async () => {
    const declined = [...new Set([...(state.settings.scanOptions.declinedCoursePrefixes || []), ...courseSuggestionPrefixes()])];
    applySettings(await api.setSetting('declinedCoursePrefixes', declined));
    $('courseAlert').hidden = true;
});
$('courseNamespaces').addEventListener('change', async (event) => applySettings(await api.setSetting('courseNamespaces', event.target.value)));
$('loadExistingSongs').addEventListener('click', async () => {
    $('existingSongsError').hidden = true;
    try {
        applySettings(await api.loadExistingSongs());
    } catch (error) {
        $('existingSongsError').textContent = cleanError(error);
        $('existingSongsError').hidden = false;
    }
});
$('clearExistingSongs').addEventListener('click', async () => applySettings(await api.clearExistingSongs()));
document.querySelector('.lab-main').addEventListener('click', (event) => {
    const undo = event.target.closest('[data-undo]');
    if (undo) return undoMark(undo.dataset.undo);
    const wrongSong = event.target.closest('[data-wrong-song]');
    if (wrongSong) return songMenu(wrongSong, state.view.songs.find((song) => song.key === wrongSong.dataset.wrongSong));
    const wrongFile = event.target.closest('[data-wrong-file]');
    if (wrongFile) return fileMenu(wrongFile, state.view.files.find((file) => file.fileId === wrongFile.dataset.wrongFile));
    const match = event.target.closest('[data-open-song]');
    if (match) return openSong(match.dataset.openSong);
    const row = event.target.closest('tr[data-song]');
    if (row) openSong(row.dataset.song);
});
$('openSettings').addEventListener('click', openSettings);
// Metrics include marks and check answers given since the scan, so the Lab is drawn again on opening.
function openLabScreen() {
    if (state.view) renderLab();
    navigate('lab');
}
$('openLab').addEventListener('click', openLabScreen);
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
    openLabScreen();
});
api.onNewScan(newScan);
api.onOpenPrevious(async () => {
    const scans = await goHome();
    if (!scans?.length) window.showToast?.('No previous scans yet.', 'info');
});
api.getSettings().then(applySettings);
renderHistory();
