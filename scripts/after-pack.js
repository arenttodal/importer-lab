'use strict';

// electron-builder afterPack hook. While the app is unsigned (no Developer ID yet), give the merged
// universal app an ad-hoc signature. Without any signature, macOS on Apple silicon reports a
// downloaded app as "damaged" and offers no way to open it; with an ad-hoc one it shows the normal
// "unidentified developer" warning, which System Settings can override.
// When MAC_SIGNING=on, electron-builder signs with the Developer ID certificate instead.

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Arch } = require('builder-util');

exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    if (process.env.MAC_SIGNING === 'on') return;
    if (context.arch !== Arch.universal) return; // sign once, after the x64 and arm64 apps are merged
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
