'use strict';

// Adapter 10: an offline copy of the app's Tailwind, built exactly the way the app's own
// production build does it (scripts/build/build-frontend.js buildTailwindCss): @tailwindcss/cli
// 4.3.3 over public/tailwind-input.css with the app's tailwind.config.cjs. Nothing is written
// inside vendor/the-library. Re-run after moving the submodule pin.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'vendor', 'the-library');
const OUTPUT = path.join(ROOT, 'apps', 'lab', 'renderer', 'vendor', 'tailwind-build.css');

const cliPackage = require.resolve('@tailwindcss/cli/package.json');
const bin = path.resolve(path.dirname(cliPackage), require(cliPackage).bin.tailwindcss);

execFileSync(process.execPath, [bin, '-c', path.join(APP, 'tailwind.config.cjs'), '-i', path.join(APP, 'public', 'tailwind-input.css'), '-o', OUTPUT, '--minify'], {
    cwd: APP,
    stdio: 'inherit'
});
console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
