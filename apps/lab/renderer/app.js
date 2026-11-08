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
    right: { song: 'Right' },
    rename: { song: 'Renamed' }
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
    ai: 'Asking AI about the unclear songs…',
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

const money = (dollars) => `$${(dollars || 0).toFixed(dollars && dollars < 0.1 ? 4 : 2)}`;

function onProgress(progress) {
    $('scanPhase').textContent =
        progress.phase === 'ai'
            ? `${PHASE_TEXT.ai} ${(progress.aiDone || 0).toLocaleString()} of ${(progress.aiItems || 0).toLocaleString()} answered · AI cost so far ${money(progress.aiCostUsd)} of ${money(state.settings.ai.maxCostUsd)}.`
            : `${PHASE_TEXT[progress.phase] || progress.phase} ${progress.files.toLocaleString()} files so far.`;
    if (progress.phase === 'ai') return;
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
        song.decidedBy === 'ai' ? '<span class="std-chip">AI suggestion</span>' : '',
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
    renderQuestions(view);
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

// Song marks carry the song's file names, so they can become rules that survive renamed songs.
function fileNamesOf(songName) {
    const song = state.view?.songs.find((candidate) => candidate.name === songName);
    if (!song) return null;
    const byId = new Map(state.view.files.map((file) => [file.fileId, file.name]));
    return song.fileIds.map((id) => byId.get(id)).filter(Boolean);
}

async function saveMark(input) {
    const withNames = input.target === 'song' && !input.fileNames ? { ...input, fileNames: fileNamesOf(input.songName) } : input;
    const mark = await api.addMark(withNames);
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
        { label: 'Not a real song', onSelect: () => saveMark({ kind: 'wrong-song', target: 'song', songName: song.name }) },
        { label: 'Rename…', onSelect: () => openRename(song) }
    ]);
}

function openRename(song) {
    const body = document.createElement('div');
    body.innerHTML = `<input class="std-form-input" type="text" aria-label="New name" value="${escapeHtml(song.name)}" />`;
    const input = body.querySelector('input');
    const modal = window.createStandardModal({
        archetype: 'standard',
        title: 'Rename',
        subtitle: 'The song is shown under this name from the next scan on (kept as a rule).',
        body,
        primaryAction: {
            label: 'Save',
            onClick: async () => {
                const newName = input.value.trim();
                if (newName && newName !== song.name) await saveMark({ kind: 'rename', target: 'song', songName: song.name, newName });
                modal.close();
            }
        }
    });
    input.focus();
    input.select();
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
                const updated = await api.updateMark(mark.id, { mergeWithSongName: chosen, mergeWithFileNames: fileNamesOf(chosen) });
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

const MODEL_LABEL = {
    'claude-haiku-5-5': 'Claude Haiku 5.5 (fast, lowest cost)',
    'claude-sonnet-5-5': 'Claude Sonnet 5.5',
    'claude-opus-5-5': 'Claude Opus 5.5 (highest cost)'
};

function applyAiSettings(ai) {
    $('aiEnabled').checked = ai.enabled;
    $('aiMaxCostUsd').value = ai.maxCostUsd;
    const options = (selected, withNone) =>
        (withNone ? [`<option value=""${selected ? '' : ' selected'}>None</option>`] : [])
            .concat(ai.models.map((model) => `<option value="${model}"${model === selected ? ' selected' : ''}>${escapeHtml(MODEL_LABEL[model] || model)}</option>`))
            .join('');
    $('aiModel').innerHTML = options(ai.model, false);
    $('aiLargeModel').innerHTML = options(ai.largeModel, true);
    $('aiKeyStatus').textContent = ai.key.hasKey ? `Key set (from ${ai.key.source})` : 'No key yet';
    $('aiRemoveKey').hidden = ai.key.source !== 'Settings';
}

function openAiKey() {
    const body = document.createElement('div');
    body.innerHTML = `<label class="std-form-row"><span class="std-form-label">Anthropic API key</span><input class="std-form-input" type="password" autocomplete="off" spellcheck="false" /></label>
        <p class="std-form-help">Kept encrypted on this Mac by the system keychain. Used only for the AI pass, and only while it is switched on.</p>`;
    const input = body.querySelector('input');
    const modal = window.createStandardModal({
        archetype: 'compact',
        title: 'Add AI key',
        body,
        primaryAction: {
            label: 'Save',
            onClick: async () => {
                try {
                    applySettings(await api.saveAiKey(input.value));
                    modal.close();
                    window.showToast?.('Key saved.', 'success');
                } catch (error) {
                    window.showToast?.(cleanError(error), 'error');
                }
            }
        }
    });
    input.focus();
}

function applySettings(settings) {
    state.settings = settings;
    applyAiSettings(settings.ai);
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
    if (section === 'rules') renderRules();
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
            // Merged: whole songs of today's importer joined. Moved files: some files came out of another of today's songs.
            const change = todays.length > 1 ? (outside ? 'Moved files' : `Merged ${todays.length}`) : outside ? 'Split from' : todays[0] && todays[0].songName !== song.name ? 'Renamed' : 'Same';
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
            ...Object.entries(summary.byEngineVersion || {}).map(([version, stats]) => [`Checked with engine ${version}`, `${stats.right} of ${stats.answered} right (at least ${Math.floor(stats.lowerBound95 * 100)}%)`]),
            ["Today's importer on the songs you checked", todayOnChecked(view)],
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
            ...timingRows(view.notes.timings || {}, view.notes.clueCounts || {}, view.notes.readers || {}),
            ...aiRows(view),
            ['Engine / name and scoring policy', `${view.engineVersion} / ${view.policyVersion}`],
            ['Contract', view.contractVersion],
            ['Main app commit', info.pinnedCommit.slice(0, 8)],
            ['Electron / Node / SQLite', `${info.electron} / ${info.node} / ${info.sqlite}`],
            ['Network requests blocked', info.blockedRequests]
        ];
        $('metricsRows').innerHTML = rows.map(([key, value]) => `<tr><td class="lab-muted">${escapeHtml(key)}</td><td>${escapeHtml(value)}</td></tr>`).join('');
    });
    const aiLog = view.notes.ai
        ? [
              '',
              'AI calls (one line per call; no key, no paths):',
              ...view.notes.ai.calls.map((call) => `${call.at} ${call.model} · ${call.items} songs · ${call.inputTokens} in / ${call.outputTokens} out tokens (cache ${call.cacheReadTokens} read, ${call.cacheWriteTokens} written) · ${money(call.costUsd)} · ${call.durationMs} ms · ${call.stopReason}`),
              ...view.notes.ai.errors.map((error) => `AI error: ${error}`)
          ]
        : [];
    $('logText').textContent = [...view.notes.baselineLog, ...aiLog, '', JSON.stringify({ typeCounts: view.notes.typeCounts, stats: view.stats }, null, 2)].join('\n');
}

function aiRows(view) {
    const ai = view.notes.ai;
    if (!ai) return [['AI pass', 'off (everything above is without AI)']];
    return [
        ['AI cost', `${money(ai.costUsd)}${ai.capped ? ' (stopped at the cap)' : ''}`],
        ['AI: unclear songs asked / answered / from earlier answers', `${ai.asked} / ${ai.answered} / ${ai.fromCache}`],
        ['AI: suggestions / own song / not sure / merged (same name)', `${ai.suggested} / ${ai.ownSong} / ${ai.notSure} / ${ai.merged}`],
        ['AI: calls / models', `${ai.calls.length} / ${[...new Set(ai.calls.map((call) => call.model))].join(', ') || ai.model}`],
        ['AI: left unasked by the cap / answers dropped / errors', `${ai.skippedByCap} / ${ai.dropped} / ${ai.errors.length}`]
    ];
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
    aiMs: 'Time: AI pass',
    storeSaveMs: 'Time: saving the scan',
    totalMs: 'Time: total'
};

const READER_LABEL = { ableton: 'Ableton sets', abletonFolder: 'Ableton project folders', logic: 'Logic packages', audioHeader: 'WAV/AIFF lengths', other: 'Other files' };

function timingRows(timings, counts, readers = {}) {
    const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`;
    const rows = Object.keys(TIMING_LABEL)
        .filter((key) => typeof timings[key] === 'number')
        .map((key) => [TIMING_LABEL[key], seconds(timings[key])]);
    for (const [reader, stats] of Object.entries(readers)) {
        if (!stats.files) continue;
        rows.push([`Reading: ${READER_LABEL[reader] || reader}`, `${stats.files} files, ${(stats.ms / 1000).toFixed(1)} s, ${stats.megabytes} MB, slowest ${(stats.slowestMs / 1000).toFixed(1)} s`]);
    }
    if (typeof counts.filesOpened === 'number') {
        rows.push(['Files opened for clues / not opened (stored from the last scan, or in the cloud)', `${counts.filesOpened} / ${counts.filesNotOpened}`]);
        rows.push(['Same-size files: edge-checked / hashed in full', `${counts.sameSizeFilesChecked} / ${counts.filesHashedInFull}`]);
    }
    return rows;
}

// ── Teach the importer: questions about words in the catalog, answers kept as rules ──

const ROLE_LABEL = {
    band: 'A band, artist or client',
    series: 'A series of ideas (like Morning 5)',
    course: 'Course or tutorial material',
    pack: 'A sample pack',
    collaborator: "A collaborator's name",
    word: 'Just part of song titles'
};

function shown(prefix) {
    return prefix.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function renderQuestions(view) {
    const questions = view.notes.questions || [];
    $('questionsAlert').hidden = questions.length === 0;
    if (!questions.length) return;
    $('questionsCount').textContent = `${questions.length} quick question${questions.length === 1 ? '' : 's'}`;
    $('questionsDetail').textContent = `What do ${questions.slice(0, 3).map((question) => `“${shown(question.prefix)}”`).join(', ')}${questions.length > 3 ? ' and others' : ''} mean in your catalog? Your answers apply from the next scan.`;
}

function openQuestions() {
    const questions = state.view?.notes.questions || [];
    if (!questions.length) return window.showToast?.('No open questions. Answers can be changed under Lab → Rules.', 'success');
    const body = document.createElement('div');
    body.className = 'lab-picker';
    body.innerHTML = questions
        .map(
            (question, index) => `<div class="std-form-row">
                <span class="std-form-label">What is “${escapeHtml(shown(question.prefix))}”? <span class="lab-muted">${question.files} files · e.g. ${escapeHtml(question.examples.join(' · '))}</span></span>
                <select class="std-form-input" data-question="${index}">
                    ${Object.entries(ROLE_LABEL).map(([role, label]) => `<option value="${role}"${role === question.guess ? ' selected' : ''}>${escapeHtml(label)}${role === question.guess ? ' (our guess)' : ''}</option>`).join('')}
                    <option value="">Not sure (skip)</option>
                </select>
            </div>`
        )
        .join('');
    const modal = window.createStandardModal({
        archetype: 'standard',
        title: 'Teach the importer',
        subtitle: 'Each answer is kept as a rule and applied first on the next scan. You can change them under Lab → Rules.',
        body,
        primaryAction: {
            label: 'Save and scan again',
            onClick: async () => {
                const answers = {};
                for (const select of body.querySelectorAll('[data-question]')) if (select.value) answers[questions[Number(select.dataset.question)].prefix] = select.value;
                await api.answerPrefixes(answers);
                modal.close();
                startScan();
            }
        }
    });
}

async function renderRules() {
    const rules = await api.getRules();
    const entries = Object.entries(rules.prefixes);
    $('rulesPrefixes').innerHTML = entries.length
        ? entries
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([prefix, role]) => `<div class="std-list-row"><span class="std-list-label">${escapeHtml(shown(prefix))}<br /><span class="std-list-meta">${escapeHtml(ROLE_LABEL[role] || role)}</span></span><button class="std-inline-btn" type="button" data-forget-prefix="${escapeHtml(prefix)}">Forget</button></div>`)
              .join('')
        : '<div class="lab-muted">No answers yet.</div>';
    const counts = rules.fromMarks;
    $('rulesFromMarks').textContent = `${counts.together} keep-together, ${counts.apart} keep-apart, ${counts.remove} file-out and ${counts.names} rename rules from your marks.`;
    $('rulesUseMarks').checked = rules.useMarks;
    renderCorrections();
}

const CORRECTION_TEXT = {
    split: (mark) => `Should be split: “${mark.songName}”`,
    merge: (mark) => `Should be merged: “${mark.songName}” with “${mark.mergeWithSongName || '…'}”`,
    'wrong-song': (mark) => (mark.target === 'file' ? `Wrong song: “${mark.fileName}” is not part of “${mark.songName}”` : `Wrong: “${mark.songName}”`),
    rename: (mark) => `Rename: “${mark.songName}” to “${mark.newName}”`
};

async function renderCorrections() {
    const list = await api.listCorrections();
    $('rulesCorrections').innerHTML = list.length
        ? list
              .map((mark) => {
                  const text = (CORRECTION_TEXT[mark.kind] || ((m) => m.songName))(mark);
                  const meta = `${new Date(mark.createdAt).toLocaleString()}${mark.check ? ' · in a check' : ''} · engine ${mark.engineVersion || 'unknown'}`;
                  return `<div class="std-list-row"><span class="std-list-label">${escapeHtml(text)}<br /><span class="std-list-meta">${escapeHtml(meta)}</span></span><button class="std-inline-btn" type="button" data-undo-correction="${escapeHtml(mark.catalogId)}/${escapeHtml(mark.id)}">Undo</button></div>`;
              })
              .join('')
        : '<div class="lab-muted">No corrections yet.</div>';
}

// ── "Check songs" (10, 20 or 50): a random sample, one song at a time, answered with one click ──

// The sample comes from the main process: weighted toward songs to check, unclear songs and songs
// with several files, leaving out songs already checked (apps/lab/src/check.js).
function chooseCheck() {
    const body = document.createElement('div');
    body.innerHTML = `<div class="std-radio-group">
        <label class="std-radio"><input class="std-radio-input" type="radio" name="checkSize" value="10" checked /><span class="std-radio-dot"></span><span class="std-radio-label">Short: 10 songs</span></label>
        <label class="std-radio"><input class="std-radio-input" type="radio" name="checkSize" value="20" /><span class="std-radio-dot"></span><span class="std-radio-label">Standard: 20 songs</span></label>
        <label class="std-radio"><input class="std-radio-input" type="radio" name="checkSize" value="50" /><span class="std-radio-dot"></span><span class="std-radio-label">Deep: 50 songs</span></label>
    </div>`;
    const modal = window.createStandardModal({
        archetype: 'compact',
        title: 'Check songs',
        subtitle: 'A random sample, weighted toward the songs most likely to be wrong. Every check adds to the confidence in Metrics.',
        body,
        primaryAction: {
            label: 'Start',
            onClick: () => {
                const size = Number(body.querySelector('input[name="checkSize"]:checked').value);
                modal.close();
                startCheck(size);
            }
        }
    });
}

async function startCheck(size) {
    const picks = await api.checkSample(size);
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

// How today's importer did on the songs checked in this scan: a song marked right counts for today
// when one of today's songs holds exactly its files; a merge mark when both songs' files are in one.
function todayOnChecked(view) {
    const marks = state.marks.filter((mark) => mark.check && mark.scanId === view.scanId);
    if (!marks.length) return 'No songs checked in this scan yet.';
    const todayOf = new Map();
    for (const group of view.baselines.preserve.groups) for (const id of group.fileIds) todayOf.set(id, group);
    const idsOf = (name) => view.songs.find((song) => song.name === name)?.fileIds || [];
    let right = 0;
    for (const mark of marks) {
        const ids = idsOf(mark.songName);
        const groups = new Set(ids.map((id) => todayOf.get(id)));
        if (mark.kind === 'right') right += Number(groups.size === 1 && [...groups][0] && [...groups][0].fileIds.length === ids.length);
        else if (mark.kind === 'merge') right += Number(new Set([...ids, ...idsOf(mark.mergeWithSongName)].map((id) => todayOf.get(id))).size === 1);
        else if (mark.kind === 'split') right += Number(groups.size > 1);
    }
    return `${right} of ${marks.length} as you marked them (the new engine: ${marks.filter((mark) => mark.kind === 'right').length})`;
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
$('checkStart').addEventListener('click', chooseCheck);
$('rulesCorrections').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-undo-correction]');
    if (!button) return;
    const [catalogId, markId] = button.dataset.undoCorrection.split('/');
    await api.removeCorrection(catalogId, markId);
    state.marks = (state.marks || []).filter((mark) => mark.id !== markId);
    renderRules();
    window.showToast?.('Undone. The next scan no longer applies it.', 'success');
});
$('scanFromScratch').addEventListener('click', () => startScan({ fromScratch: true }));
$('questionsOpen').addEventListener('click', openQuestions);
$('rulesAsk').addEventListener('click', openQuestions);
$('rulesPrefixes').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-forget-prefix]');
    if (!button) return;
    await api.answerPrefixes({ [button.dataset.forgetPrefix]: null });
    renderRules();
});
$('rulesUseMarks').addEventListener('change', async (event) => {
    await api.setUseMarks(event.target.checked);
    renderRules();
});
$('checkBar').addEventListener('click', async (event) => {
    const same = event.target.closest('[data-same-song]');
    if (same && state.check) {
        const song = state.song;
        const pick = state.check.picks.get(song.key) || {};
        const mark = await saveMark({ kind: 'merge', target: 'song', songName: song.name, check: true, songBand: song.band, songKind: song.kind, stratum: pick.stratum, sampleWeight: pick.weight });
        const updated = await api.updateMark(mark.id, { mergeWithSongName: same.dataset.sameSong, mergeWithFileNames: fileNamesOf(same.dataset.sameSong) });
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
$('aiEnabled').addEventListener('change', async (event) => applySettings(await api.setSetting('aiEnabled', event.target.checked)));
$('aiModel').addEventListener('change', async (event) => applySettings(await api.setSetting('aiModel', event.target.value)));
$('aiLargeModel').addEventListener('change', async (event) => applySettings(await api.setSetting('aiLargeModel', event.target.value)));
$('aiMaxCostUsd').addEventListener('change', async (event) => {
    try {
        applySettings(await api.setSetting('aiMaxCostUsd', event.target.value));
    } catch (error) {
        window.showToast?.(cleanError(error), 'error');
        applySettings(state.settings);
    }
});
$('aiAddKey').addEventListener('click', openAiKey);
$('aiRemoveKey').addEventListener('click', async () => applySettings(await api.removeAiKey()));
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
