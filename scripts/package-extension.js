/**
 * Packaging script for PhishTank Browser Extension (Manifest V3)
 * Compresses extension/ into dist/phishtank-extension.zip with POSIX forward slashes (/)
 * required by Mozilla Add-ons (addons.mozilla.org) and Chrome Web Store.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');
const distDir = path.join(rootDir, 'dist');
const zipFile = path.join(distDir, 'phishtank-extension.zip');

console.log('📦 Packaging PhishTank Browser Extension...');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

try {
  // Use Python zipfile to guarantee POSIX forward slashes ('/') inside the .zip archive
  const pyScript = [
    'import os, zipfile',
    `ext_dir = r'''${extensionDir}'''`,
    `out_zip = r'''${zipFile}'''`,
    "with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as zf:",
    '    for root, _, files in os.walk(ext_dir):',
    '        for f in sorted(files):',
    '            full = os.path.join(root, f)',
    "            arc = os.path.relpath(full, ext_dir).replace('\\\\', '/')",
    '            zf.write(full, arc)',
    "with zipfile.ZipFile(out_zip, 'r') as zf:",
    "    print('Archive entries:', zf.namelist())"
  ].join('\n');

  execSync('python -', { input: pyScript, stdio: ['pipe', 'inherit', 'inherit'] });

  const stats = fs.statSync(zipFile);
  console.log(`\n🎉 Successfully packaged extension!`);
  console.log(`📍 File: ${zipFile}`);
  console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`\n🚀 Upload this .zip to:`);
  console.log(`- Firefox: https://addons.mozilla.org/developers/addon/submit/distribution`);
  console.log(`- Chrome:  https://chrome.google.com/webstore/devconsole`);
} catch (error) {
  console.error('❌ Failed to package extension:', error.message);
  process.exit(1);
}
