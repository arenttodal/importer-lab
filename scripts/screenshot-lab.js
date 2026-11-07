'use strict';

// Dev tool: launches the real lab in Electron, scans a folder and screenshots screens 1–3.
// Needs Playwright (not a lab dependency). Usage:
//   node scripts/screenshot-lab.js <folder-to-scan> <output-folder>

const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron } = require('playwright');

// Let the app's 0.15s transitions finish before a screenshot.
function settle(page) {
    return page.waitForTimeout(400);
}

async function main() {
    const [folder, outDir] = process.argv.slice(2);
    if (!folder || !outDir) throw new Error('Usage: node scripts/screenshot-lab.js <folder-to-scan> <output-folder>');
    fs.mkdirSync(outDir, { recursive: true });
    const dataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lab-shot-data-'));
    const env = { ...process.env, IMPORTER_LAB_ROOTS: path.resolve(folder), IMPORTER_LAB_DATA: dataDir };
    delete env.NODE_OPTIONS;
    const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..', 'apps', 'lab')], env });
    const page = await app.firstWindow();
    const errors = [];
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.waitForSelector('#folderList .std-list-row');
    await page.waitForFunction(() => document.getElementById('runtimeInfo').textContent.length > 0);
    await page.screenshot({ path: path.join(outDir, '1-choose-folders.png') });
    await page.click('#startScan');
    await page.waitForSelector('#viewCatalog:not([hidden])', { timeout: 120000 });
    await settle(page);
    await page.screenshot({ path: path.join(outDir, '2-scan.png') });
    await page.click('#viewCatalog');
    await settle(page);
    await page.screenshot({ path: path.join(outDir, '3-catalog.png'), fullPage: true });
    await page.click('[data-mode="strip"]');
    await settle(page);
    await page.screenshot({ path: path.join(outDir, '3-catalog-strip.png') });
    const info = await page.evaluate(() => window.labAPI.getInfo());
    console.log(JSON.stringify({ info, consoleErrors: errors }, null, 2));
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
