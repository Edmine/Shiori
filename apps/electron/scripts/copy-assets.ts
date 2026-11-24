/**
 * Cross-platform asset copy script.
 *
 * Copies the resources/ directory to dist/resources/.
 * All bundled assets (docs, themes, permissions, tool-icons) now live in resources/
 * which electron-builder handles natively via directories.buildResources.
 *
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/resources/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { cpSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Copy all resources (icons, themes, docs, permissions, tool-icons, etc.)
cpSync('resources', 'dist/resources', { recursive: true });

console.log('✓ Copied resources/ → dist/resources/');

// Copy PowerShell parser script (for Windows command validation in Explore mode)
// Source: packages/shared/src/agent/powershell-parser.ps1
// Destination: dist/resources/powershell-parser.ps1
const psParserSrc = join('..', '..', 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
const psParserDest = join('dist', 'resources', 'powershell-parser.ps1');
try {
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
} catch (err) {
  // Only warn - PowerShell validation is optional on non-Windows platforms
  console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
}

// Copy bundled pi-agent-server so packaged apps resolve dist/resources/pi-agent-server/index.js
const piServerSrc = join('..', '..', 'packages', 'pi-agent-server', 'dist', 'index.js');
const piServerDestDir = join('dist', 'resources', 'pi-agent-server');
if (existsSync(piServerSrc)) {
  mkdirSync(piServerDestDir, { recursive: true });
  copyFileSync(piServerSrc, join(piServerDestDir, 'index.js'));
  console.log('✓ Copied pi-agent-server/dist/index.js → dist/resources/pi-agent-server/index.js');
} else {
  console.log('⚠ pi-agent-server/dist/index.js not found — run electron:build:main first');
}

// Copy mobile/remote WebUI bundle so packaged Electron apps can serve it in server mode
const webuiSrcDir = join('..', 'webui', 'dist');
const webuiDestDir = join('dist', 'webui');
if (existsSync(join(webuiSrcDir, 'index.html'))) {
  cpSync(webuiSrcDir, webuiDestDir, { recursive: true });
  console.log('✓ Copied apps/webui/dist → dist/webui/');
} else {
  console.log('⚠ apps/webui/dist not found — run webui build to bundle mobile remote access');
}
