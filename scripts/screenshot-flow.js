'use strict';

// Dev tool: walks the producer flow in the real lab (Electron) and screenshots every screen.
// Uses a throwaway home folder, so suggestions and the data folder never touch the real ones.
// Needs Playwright (not a lab dependency). Usage:
//   node scripts/screenshot-flow.js <music-folder-to-copy-in> <big-folder-for-desktop> <output-folder> [packaged-app-binary]
// With a packaged binary (for example dist/linux-unpacked/importer-lab) it runs the built app as a
// user would: no arguments and no lab environment variables.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron: electron } = require('playwright');

const settle = (page, ms = 400) => page.waitForTimeout(ms);

async function main() {
    const [musicSource, desktopSource, outDir, packagedBinary] = process.argv.slice(2);
    if (!outDir) throw new Error('Usage: node scripts/screenshot-flow.js <music-folder> <desktop-folder> <output-folder>');
    fs.mkdirSync(outDir, { recursive: true });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-flow-home-'));
    fs.cpSync(musicSource, path.join(home, 'Music', path.basename(musicSource)), { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
    fs.cpSync(desktopSource, path.join(home, 'Desktop', path.basename(desktopSource)), { recursive: true, preserveTimestamps: true });
    fs.mkdirSync(path.join(home, 'Documents'));

    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') };
    delete env.NODE_OPTIONS;
    for (const key of Object.keys(env)) if (key.startsWith('IMPORTER_LAB_')) delete env[key];
    const app = packagedBinary
        ? await electron.launch({ executablePath: path.resolve(packagedBinary), args: [], env })
        : await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..', 'apps', 'lab')], env });
    const page = await app.firstWindow();
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1180, height: 820 });
    let shot = 0;
    const snap = async (name) => page.screenshot({ path: path.join(outDir, `${String(++shot).padStart(2, '0')}-${name}.png`) });

    await page.waitForSelector('#welcomeStart');
    await snap('welcome');
    await page.click('#welcomeStart');
    await page.waitForSelector('#folderList .lab-folder-row');
    await page.check('#folderList .lab-folder-row:has-text("Desktop") input');
    await settle(page);
    await snap('choose-folders');
    await page.click('#foldersContinue');
    await page.waitForSelector('[data-screen="permission"]:not([hidden])');
    await snap('permission');
    await page.click('#permissionContinue');
    await page.waitForSelector('[data-screen="scanning"]:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#liveSongs .std-chip').length >= 20);
    await snap('scanning');
    await page.waitForSelector('#seeCatalog:not([hidden])', { timeout: 120000 });
    await settle(page);
    await snap('scan-done');
    await page.click('#seeCatalog');
    await settle(page);
    await snap('catalog');
    await page.locator('tr[data-song] .song-name-line p', { hasText: /(^| - )Sky$/ }).first().click();
    await settle(page);
    await snap('song-detail');
    await page.click('#songActions [data-wrong-song]');
    await settle(page);
    await snap('this-is-wrong-menu');
    await page.click('.std-menu .std-menu-item:has-text("merged")');
    await page.waitForSelector('.std-modal');
    await page.fill('.std-modal input[type="search"]', 'sky');
    await page.locator('.std-modal [data-pick]').first().click();
    await settle(page);
    await snap('merge-with');
    await page.click('.std-modal .std-modal-btn--primary');
    await settle(page);
    await page.click('#songFiles [data-wrong-file]');
    await page.click('.std-menu .std-menu-item');
    await settle(page, 600);
    await snap('song-marked');
    await page.click('#navBack');
    await settle(page);
    if (await page.isVisible('#questionsAlert')) {
        await snap('teach-the-importer');
        await page.click('#questionsOpen');
        await page.waitForSelector('.std-modal');
        await settle(page);
        await snap('teach-the-importer-questions');
        await page.keyboard.press('Escape');
        await settle(page);
    }
    const loose = page.locator('tr[data-song="loose-stems"] .song-name-line p');
    if (await loose.count()) {
        await loose.first().click();
        await settle(page);
        await snap('loose-stems');
        await page.click('#navBack');
    }
    await page.click('#checkStart');
    await page.waitForSelector('.std-modal');
    await settle(page);
    await snap('check-choose-size');
    await page.click('.std-modal .std-modal-btn--primary');
    await settle(page);
    await snap('check-10-songs');
    for (const answer of ['right', 'skip', 'wrong-song']) {
        await page.click(`#checkBar [data-check="${answer}"]`);
        await settle(page, 250);
    }
    await snap('check-10-songs-later');
    await page.click('#navBack');
    await settle(page);
    await page.click('#exportResults');
    await settle(page, 600);
    await snap('send-results');
    await page.click('#openSettings');
    await page.waitForSelector('.std-modal');
    await page.click('.std-modal .std-toggle');
    await settle(page);
    await snap('settings');
    await page.click('.std-modal .std-modal-btn--primary');
    await page.click('#openLab');
    await settle(page);
    await snap('lab-compare');
    for (const section of ['options', 'rules', 'metrics', 'logs']) {
        await page.click(`[data-lab="${section}"]`);
        await settle(page);
        await snap(`lab-${section}`);
        if (section === 'options') {
            await page.locator('#aiEnabled').scrollIntoViewIfNeeded();
            await settle(page);
            await snap('lab-options-ai');
            await page.click('#aiAddKey');
            await page.waitForSelector('.std-modal input[type="password"]');
            await settle(page);
            await snap('lab-options-ai-key');
            await page.keyboard.press('Escape');
            await settle(page);
        }
        if (section === 'rules') {
            const before = await page.locator('#rulesCorrections [data-undo-correction]').count();
            await page.locator('#rulesCorrections [data-undo-correction]').first().click();
            await settle(page, 600);
            const after = await page.locator('#rulesCorrections [data-undo-correction]').count();
            console.log(JSON.stringify({ correctionsBeforeUndo: before, correctionsAfterUndo: after }));
            await snap('lab-rules-after-undo');
        }
    }


    // Navigation: Home, previous scans, New scan, Back, See all, delete, File menu.
    const clickMenu = (label) =>
        app.evaluate(({ Menu }, itemLabel) => {
            const file = Menu.getApplicationMenu().items.find((item) => item.label === 'File');
            file.submenu.items.find((item) => item.label === itemLabel).click();
        }, label);
    await page.click('#navHome');
    await page.waitForSelector('#scanHistoryList [data-open-scan]');
    await settle(page);
    await snap('home-previous-scans');
    await page.click('#welcomeStart');
    await page.waitForSelector('[data-screen="folders"]:not([hidden])');
    await page.uncheck('#folderList .lab-folder-row:has-text("Desktop") input');
    await settle(page);
    await snap('new-scan-with-back');
    await page.click('#foldersContinue');
    await page.waitForSelector('#seeCatalog:not([hidden])', { timeout: 120000 });
    await settle(page);
    await snap('scan-done-first-20');
    await page.click('#navBack');
    await page.waitForSelector('[data-screen="folders"]:not([hidden])');
    await clickMenu('Open Previous Results…');
    await page.waitForSelector('[data-screen="welcome"]:not([hidden]) #scanHistoryList [data-open-scan]');
    const rows = await page.locator('#scanHistoryList [data-open-scan]').count();
    await page.locator('#scanHistoryList [data-open-scan]').nth(1).click();
    await page.waitForSelector('[data-screen="catalog"]:not([hidden])');
    await settle(page);
    await snap('reopened-previous-scan');
    await page.click('#navBack');
    await page.locator('#scanHistoryList [data-delete-scan]').nth(1).click();
    await page.waitForSelector('.std-modal');
    await settle(page);
    await snap('delete-confirm');
    await page.click('.std-modal .std-modal-btn--destructive');
    await settle(page);
    const rowsAfterDelete = await page.locator('#scanHistoryList [data-open-scan]').count();
    await clickMenu('New Scan');
    await page.waitForSelector('[data-screen="folders"]:not([hidden])');
    const fileMenuNewScan = await page.isVisible('#navBack');
    console.log(JSON.stringify({ historyRows: rows, rowsAfterDelete, fileMenuNewScanShowsFoldersWithBack: fileMenuNewScan }));

    const exportDir = path.join(home, '.config', 'Importer Lab', 'lab-data', 'exports');
    const exported = fs.readdirSync(exportDir);
    const labelsDir = path.join(home, '.config', 'Importer Lab', 'lab-data', 'labels');
    console.log(JSON.stringify({ consoleErrors: errors, exported, labels: fs.readdirSync(labelsDir) }, null, 2));
    fs.copyFileSync(path.join(exportDir, exported[0]), path.join(outDir, 'example-results.json'));
    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
