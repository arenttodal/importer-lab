'use strict';

// Vendors Inter (SIL Open Font License 1.1) from @fontsource/inter so the lab matches the app
// offline. Same weights the app loads from Google Fonts (300, 400, 500, 600; 700 for bold text).

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.dirname(require.resolve('@fontsource/inter/package.json'));
const TARGET = path.join(__dirname, '..', 'apps', 'lab', 'renderer', 'vendor', 'fonts');
const WEIGHTS = [300, 400, 500, 600, 700];
const SUBSETS = ['latin', 'latin-ext'];

fs.mkdirSync(TARGET, { recursive: true });
const faces = [];
for (const weight of WEIGHTS) {
    for (const subset of SUBSETS) {
        const file = `inter-${subset}-${weight}-normal.woff2`;
        fs.copyFileSync(path.join(SOURCE, 'files', file), path.join(TARGET, file));
        faces.push(`@font-face {\n    font-family: 'Inter';\n    font-style: normal;\n    font-display: swap;\n    font-weight: ${weight};\n    src: url('./${file}') format('woff2');\n}`);
    }
}
fs.copyFileSync(path.join(SOURCE, 'LICENSE'), path.join(TARGET, 'LICENSE-OFL.txt'));
fs.writeFileSync(path.join(TARGET, 'inter.css'), `/* Inter by Rasmus Andersson, SIL Open Font License 1.1 (LICENSE-OFL.txt). Vendored by scripts/vendor-fonts.js from @fontsource/inter ${require(path.join(SOURCE, 'package.json')).version}. */\n${faces.join('\n')}\n`);
console.log(`Wrote ${faces.length} font faces to ${path.relative(path.join(__dirname, '..'), TARGET)}`);
